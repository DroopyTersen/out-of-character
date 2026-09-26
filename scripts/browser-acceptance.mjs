import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Fixture boundaries: a synthetic microphone and a browser-only controlled draw.
// AudioWorklet, Flux, Luna scenes, and both Jev evaluations remain real.
const engine = process.env.ACCEPTANCE_ENGINE || 'chromium';
if (engine === 'webkit') process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/tmp/ooc-playwright';
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.ACCEPTANCE_URL || 'http://localhost:5173';
const output = resolve(process.env.ACCEPTANCE_OUTPUT || 'output/browser-acceptance');
const mode = process.argv.find(value => value.startsWith('--mode='))?.split('=')[1] || 'happy';
const selectedCase = process.argv.find(value => value.startsWith('--case='))?.split('=')[1];
const includesCase = name => !selectedCase || selectedCase === name;
const fixtureScene = process.env.ACCEPTANCE_FIXTURE_SCENE === '1';
assert(!fixtureScene || (!['happy', 'all'].includes(mode) && selectedCase && selectedCase !== 'scene-failure'), 'Fixture scenes are allowed only for an isolated lifecycle case.');
const wav = resolve(process.env.ACCEPTANCE_AUDIO || '/tmp/ooc-positive.wav');
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(output, { recursive: true });
assert(['chromium', 'webkit'].includes(engine), 'Unknown browser engine.');
const browser = await playwright[engine].launch(engine === 'webkit' ? { headless: true } : {
  executablePath, headless: true,
  args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const fixture = engine === 'webkit' ? await readFile(wav) : null;
const report = {
  checkedAt: new Date().toISOString(), baseUrl, mode, selectedCase, fixtureScene, engine, browser: browser.version(), syntheticAudio: wav,
  fixtureBoundary: engine === 'webkit' ? 'getUserMedia returns a real WebAudio MediaStreamDestination playing the WAV' : 'Chrome fake microphone plays the WAV',
  physicalIPhoneVerified: false,
  controlledDraw: 'architecture-astronaut, index 4 of 42, browser-only RNG override', cases: [],
};

function assert(condition, message) { if (!condition) throw new Error(message); }
function verifyComposite(result) {
  const keys = Object.keys(result.readings || {});
  assert(keys.length === 42 && keys.includes('architecture-astronaut'), 'Composite omitted the curated cast.');
  for (const map of [result.recentReadings, result.fullReadings]) {
    assert(map && Object.keys(map).length === 42 && keys.every(key => Object.hasOwn(map, key)), 'A Jev context omitted cast entries.');
  }
  for (const key of keys) {
    const recent = result.recentReadings[key], full = result.fullReadings[key], combined = result.readings[key];
    assert([recent, full, combined].every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'Invalid Jev reading.');
    assert(Math.abs(combined - (full * 7 + recent * 3) / 10) < 1e-12, 'Gauge response was not the 70% full / 30% recent score.');
  }
}
function verifyJudging(entry) {
  assert(entry.validationErrors.length === 0, entry.validationErrors.join('; '));
  assert(entry.maxConcurrentJudgeRequests <= 1, 'Browser overlapped judge cycles.');
  const calls = (entry.cleanup || entry.capture)?.judgingCalls;
  assert(calls, 'Missing browser fetch cadence evidence.');
  const starts = calls.map(call => call.atPerformanceMs).sort((a, b) => a - b);
  const intervals = starts.slice(1).map((time, index) => time - starts[index]);
  entry.judgeCadence = { cycles: starts.length, minimumIntervalMilliseconds: intervals.length ? Math.min(...intervals) : null, maxConcurrent: entry.maxConcurrentJudgeRequests };
  assert(intervals.every(interval => interval >= 900), 'Browser exceeded approximately one judge cycle per second.');
  assert(starts.every(time => starts.filter(other => other >= time && other < time + 10000).length <= 11), 'Browser burst exceeded eleven cycles in ten seconds.');
}
function verifySpeech(entry) {
  assert(entry.sockets.some(socket => socket.sentBinaryFrames > 0 && socket.providerEvents.some(event => event.type === 'TurnInfo' && event.transcript?.trim() && event.words?.some(word => Number.isFinite(word.start) && Number.isFinite(word.end)))), 'No real PCM → Flux transcript with word timestamps recorded.');
}
async function session(name, denial = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(engine === 'chromium' ? { permissions: ['microphone'] } : {}) });
  if (fixture) await context.route('**/__acceptance_fixture.wav', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: fixture }));
  await context.addInitScript(({ denial, webAudioFixture }) => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => {
      if (values instanceof Uint32Array && values.length === 1) { values[0] = Math.floor((4.5 / 42) * 2 ** 32); return values; }
      return random(values);
    };
    const tracks = [], contexts = [], sockets = [], worklets = [], judgingCalls = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === '/api/judge') {
        const payload = JSON.parse(options?.body || '{}');
        judgingCalls.push({ atEpochMs: Date.now(), atPerformanceMs: performance.now(), snapshotId: payload.snapshotId, attemptId: payload.attemptId });
      }
      return fetch(input, options);
    };
    const inputs = [];
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) { super(options); contexts.push(this); }
      createMediaStreamSource(stream) {
        const source = super.createMediaStreamSource(stream);
        const connect = source.connect.bind(source);
        source.connect = (...args) => {
          inputs.push({ source, reconnect: () => connect(...args) });
          return connect(...args);
        };
        return source;
      }
    };
    const NativeAudioWorkletNode = window.AudioWorkletNode;
    if (NativeAudioWorkletNode) window.AudioWorkletNode = class extends NativeAudioWorkletNode {
      constructor(context, name, options) {
        super(context, name, options);
        const observed = { name, contextSampleRate: context.sampleRate, createdAtEpochMs: Date.now(), readyAtEpochMs: null, pcmFrames: 0 };
        worklets.push(observed);
        this.port.addEventListener('message', event => { if (event.data.ready) observed.readyAtEpochMs = Date.now(); if (event.data.pcm instanceof ArrayBuffer) observed.pcmFrames++; });
      }
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (denial) throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      let stream;
      if (webAudioFixture) {
        const audio = new window.AudioContext();
        // Resume synchronously within the real Start/Test click before decoding.
        const resumed = audio.resume();
        try {
          const response = await fetch('/__acceptance_fixture.wav');
          const buffer = await audio.decodeAudioData(await response.arrayBuffer());
          await resumed;
          const source = audio.createBufferSource();
          source.buffer = buffer; source.loop = true;
          const destination = audio.createMediaStreamDestination();
          source.connect(destination); source.start();
          stream = destination.stream;
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { stop(); try { source.stop(); } catch {} if (audio.state !== 'closed') void audio.close().catch(() => {}); };
          }
        } catch (error) { await audio.close(); throw error; }
      } else stream = await getUserMedia(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        if (new URL(this.url).pathname !== '/api/speech') return;
        const observed = { url: this.url.split('?')[0], createdAtEpochMs: Date.now(), openedAtEpochMs: null, closedAtEpochMs: null, closeCode: null, closeReason: null, errors: 0, maxBufferedAmount: 0 };
        sockets.push(observed);
        this.addEventListener('open', () => { observed.openedAtEpochMs = Date.now(); });
        this.addEventListener('close', event => { observed.closedAtEpochMs = Date.now(); observed.closeCode = event.code; observed.closeReason = event.reason; });
        this.addEventListener('error', () => observed.errors++);
        const send = this.send.bind(this);
        this.send = data => { send(data); observed.maxBufferedAmount = Math.max(observed.maxBufferedAmount, this.bufferedAmount); };
      }
    };
    window.__oocHarness = () => ({ liveTracks: tracks.filter(track => track.readyState === 'live').length, openContexts: contexts.filter(context => context.state !== 'closed').length, contextStates: contexts.map(context => context.state), sockets: sockets.map(socket => ({ ...socket })), worklets: worklets.map(worklet => ({ ...worklet })), judgingCalls: judgingCalls.map(call => ({ ...call })) });
    window.__oocMuteFixture = () => tracks.forEach(track => { track.enabled = false; });
    window.__oocResumeFixture = () => tracks.forEach(track => { track.enabled = true; });
    window.__oocDropInput = () => {
      inputs.forEach(({ source }) => source.disconnect());
      setTimeout(() => inputs.forEach(({ source, reconnect }) => { if (source.context.state === 'running') reconnect(); }), 4000);
    };
    window.__oocDelayCapture = () => { let release; const gate = new Promise(resolve => { release = resolve; }); const current = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = async constraints => { const stream = await current(constraints); await gate; return stream; }; window.__oocReleaseCapture = release; };
  }, { denial, webAudioFixture: !!fixture });
  const page = await context.newPage();
  const entry = { name, mocked: [], responses: [], judges: [], judgeRequests: [], maxConcurrentJudgeRequests: 0, validationErrors: [], sockets: [], errors: [], progress: [] };
  if (fixture) entry.mocked.push('Only getUserMedia replaced with a WAV-fed WebAudio stream; app AudioWorklet and hosted Flux/Jev remain real.');
  if (fixtureScene) {
    await page.route('**/api/scene', route => {
      const { attemptId, requestId, characterId } = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attemptId, requestId, characterId, scene: 'Your team needs a checkout button before lunch. Explain your proposed architecture to colleagues who want to see the working screen and understand why the design requires more services.' }) });
    });
    entry.mocked.push('Scene transport returns a fixed lifecycle fixture; speech and both Jev contexts remain real.');
  }
  const requestTimes = new WeakMap(), activeJudges = new Set();
  page.on('request', request => {
    requestTimes.set(request, { monotonic: performance.now(), epochMs: Date.now() });
    if (new URL(request.url()).pathname !== '/api/judge') return;
    const evidence = { ...request.postDataJSON(), startedAtEpochMs: Date.now(), finishedAtEpochMs: null, failed: false };
    entry.judgeRequests.push(evidence);
    activeJudges.add(request);
    entry.maxConcurrentJudgeRequests = Math.max(entry.maxConcurrentJudgeRequests, activeJudges.size);
    requestTimes.get(request).judge = evidence;
  });
  const finish = (request, failed) => {
    activeJudges.delete(request);
    const judge = requestTimes.get(request)?.judge;
    if (judge) { judge.finishedAtEpochMs = Date.now(); judge.failed = failed; }
  };
  page.on('requestfinished', request => finish(request, false));
  page.on('requestfailed', request => finish(request, true));
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/api/speech') return;
    const evidence = { url: socket.url().split('?')[0], createdAtEpochMs: Date.now(), sentFrames: 0, sentBinaryFrames: 0, sentBytes: 0, receivedFrames: 0, closed: false, frameEvents: [], providerEvents: [] };
    entry.sockets.push(evidence);
    socket.on('framesent', frame => {
      const binary = typeof frame.payload !== 'string', bytes = Buffer.byteLength(frame.payload);
      evidence.sentFrames++; evidence.sentBytes += bytes; if (binary) evidence.sentBinaryFrames++;
      evidence.frameEvents.push({ direction: 'sent', atEpochMs: Date.now(), bytes, binary });
    });
    socket.on('framereceived', frame => {
      evidence.receivedFrames++;
      evidence.frameEvents.push({ direction: 'received', atEpochMs: Date.now(), bytes: Buffer.byteLength(frame.payload), binary: typeof frame.payload !== 'string' });
      try { const event = JSON.parse(frame.payload.toString()); evidence.providerEvents.push({ ...event, receivedAtEpochMs: Date.now() }); } catch { /* A non-JSON provider frame is still counted. */ }
    });
    socket.on('close', () => { evidence.closed = true; evidence.closedAtEpochMs = Date.now(); });
  });
  page.on('pageerror', error => entry.errors.push(error.message));
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!['/api/scene', '/api/judge', '/api/health', '/api/highlights'].includes(path)) return;
    const requested = requestTimes.get(response.request());
    entry.responses.push({ path, status: response.status(), milliseconds: Math.round(performance.now() - (requested?.monotonic || performance.now())), requestAtEpochMs: requested?.epochMs, responseAtEpochMs: Date.now() });
    if (!response.ok()) {
      try { const evidence = entry.responses.findLast(value => value.requestAtEpochMs === requested?.epochMs && value.path === path); if (evidence) evidence.error = (await response.json()).error; } catch { /* Failed response has no JSON body. */ }
    }
    if (path === '/api/highlights' && response.ok()) {
      try { entry.highlights = { ...await response.json(), transcript: response.request().postDataJSON().transcript }; } catch {}
    }
    if (path === '/api/judge' && response.ok()) {
      try {
        const result = await response.json();
        try { verifyComposite(result); } catch (error) { entry.validationErrors.push(error.message); }
        const payload = response.request().postDataJSON();
        entry.judges.push({ ...result, requestAtEpochMs: requested?.epochMs, responseAtEpochMs: Date.now(), transcript: payload.transcript, fullTranscript: payload.fullTranscript });
      } catch { /* Canceled response. */ }
    }
  });
  const screenshot = async suffix => page.screenshot({ path: `${output}/${name}-${suffix}.png`, fullPage: true });
  report.cases.push(entry);
  console.log(JSON.stringify({ startingCase: name, engine }));
  return { page, context, entry, screenshot };
}
async function draw(page) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await Promise.all([page.waitForRequest(request => new URL(request.url()).pathname === '/api/scene', { timeout: 10000 }), page.getByRole('button', { name: 'Spin for a character' }).click()]);
  await page.getByRole('heading', { name: 'Architecture Astronaut', exact: true }).waitFor({ timeout: 15000 });
}
async function start(page, entry) {
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some(button => (button.textContent?.includes('Start impersonating') && !button.disabled) || button.textContent?.includes('Retry scene'));
  }, undefined, { timeout: 30000 });
  if (await page.getByRole('button', { name: 'Retry scene' }).isVisible()) {
    entry.sceneRecoveryAttempts = (entry.sceneRecoveryAttempts || 0) + 1;
    await page.getByRole('button', { name: 'Retry scene' }).click();
  }
  await page.locator('button:not([disabled])').filter({ hasText: 'Start impersonating' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Start impersonating' }).click();
}
async function cleanupState(page, entry) {
  try {
    await page.waitForFunction(() => { const state = window.__oocHarness(); return state.liveTracks === 0 && state.openContexts === 0 && state.sockets.every(socket => socket.closedAtEpochMs !== null); }, undefined, { timeout: 5000 });
  } finally { entry.cleanup = await page.evaluate(() => window.__oocHarness()); }
  assert(entry.sockets.every(socket => socket.closed), 'Speech transport remained open after cleanup.');
  verifyJudging(entry);
}
async function verifyRecap(page, entry) {
  await page.waitForFunction(() => {
    const status = document.querySelector('.transcript-review [role="status"]')?.textContent;
    return status && !status.includes('finding');
  }, undefined, { timeout: 15000 });
  assert(entry.highlights?.review, 'No successful real Jev highlight review.');
  assert(await page.locator('.final-race .race-row').count() === 10, 'Final recap did not contain exactly ten characters.');
  const expected = Object.values(entry.judges.at(-1).readings).sort((a, b) => b - a).slice(0, 10).map(value => Math.round(value * 100));
  const actual = await page.locator('.final-race .race-row strong').allTextContents();
  assert(JSON.stringify(actual.map(text => parseInt(text))) === JSON.stringify(expected), 'Final chart did not use the final accepted score vector.');
  assert(await page.locator('.review-transcript').textContent() === entry.highlights.transcript, 'Rendered transcript lost or changed words.');
  const marks = await page.locator('.review-transcript mark').allTextContents();
  assert(marks.length > 0, 'Strong synthetic performance produced no highlighted passages.');
  assert(marks.every(text => entry.highlights.transcript.includes(text)), 'Highlighted words were invented.');
  entry.recap = { finalScores: actual, transcriptLength: entry.highlights.transcript.length, highlights: marks };
}
async function happy() {
  const { page, context, entry, screenshot } = await session(mode === 'pause' ? 'pause-resume-real-providers' : 'real-providers');
  let progressTimer;
  let sampling = false;
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await screenshot('idle');
    await Promise.all([page.waitForRequest(request => new URL(request.url()).pathname === '/api/scene', { timeout: 10000 }), page.getByRole('button', { name: 'Spin for a character' }).click()]);
    await page.getByRole('heading', { name: 'Architecture Astronaut', exact: true }).waitFor({ timeout: 15000 });
    await screenshot('draw');
    await start(page, entry);
    await page.getByRole('button', { name: 'Give up', exact: true }).waitFor({ timeout: 20000 });
    progressTimer = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try {
        const sample = await page.evaluate(() => ({ atEpochMs: Date.now(), hold: Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')), status: document.querySelector('.performance-status')?.textContent, captions: document.querySelector('.captions-scroll')?.textContent, capture: window.__oocHarness() }));
        entry.progress.push(sample);
        if (entry.progress.length % 100 === 1) {
          console.log(JSON.stringify({ progress: { seconds: Math.round((sample.atEpochMs - sample.capture.sockets[0]?.openedAtEpochMs) / 1000), hold: sample.hold, judgments: entry.judges.length, target: entry.judges.at(-1)?.readings['architecture-astronaut'], status: sample.status, captionTail: sample.captions?.slice(-120) } }));
          await writeFile(`${output}/progress.json`, JSON.stringify({ responses: entry.responses, judgments: entry.judges.length, samples: entry.progress.slice(-100) }, null, 2));
        }
      } catch { /* Page cleanup can cancel a final sample. */ }
      finally { sampling = false; }
    }, 100);
    await page.waitForFunction(() => {
      if (document.body.innerText.includes('Let’s take that again.')) throw new Error('Capture interrupted before transcription.');
      return (document.querySelector('.captions-scroll span')?.textContent?.trim().length || 0) > 15;
    }, undefined, { timeout: 30000 });
    await screenshot('performing');
    if (mode === 'pause') {
      await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 2, undefined, { timeout: 30000 });
      await page.evaluate(() => window.__oocMuteFixture());
      await page.waitForTimeout(4500); // Let pending transcript/result events settle.
      const pausedState = () => page.evaluate(() => ({ streak: Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')), gauge: document.querySelector('.gauge-number')?.textContent, rows: [...document.querySelectorAll('.race-row')].map(row => row.textContent), calls: window.__oocHarness().judgingCalls.length }));
      const before = await pausedState();
      assert(before.streak >= 2 && before.streak < 10, 'Pause fixture missed an active score streak.');
      await page.waitForTimeout(10500); // Longer than the former ten-second timer.
      const after = await pausedState();
      assert(JSON.stringify(before) === JSON.stringify(after), 'A speaking pause changed the streak, scores, or sent new judgments.');
      assert(await page.getByRole('button', { name: 'Give up', exact: true }).isVisible(), 'Waiting alone awarded a win.');
      entry.pause = { before, after, quietMilliseconds: 15000 };
      await screenshot('paused-preserved');
      await page.evaluate(() => window.__oocResumeFixture());
    }
    await page.getByRole('heading', { name: 'In character.', exact: true }).waitFor({ timeout: 75000 });
    await screenshot('won');
    entry.elapsed = await page.locator('.result-stats').innerText();
    assert(entry.judges.filter(judge => judge.readings['architecture-astronaut'] >= .8).length >= 10, 'Win had fewer than ten qualifying real judgments.');
    await verifyRecap(page, entry);
    await screenshot('recap');
    entry.capture = await page.evaluate(() => window.__oocHarness());
    verifySpeech(entry);
    assert(entry.capture.worklets.some(worklet => worklet.name === 'pcm-capture' && worklet.pcmFrames > 0 && worklet.readyAtEpochMs), 'Actual app AudioWorklet did not produce PCM.');
    verifyJudging(entry);
    if (mode === 'pause') assert(entry.judges.some(judge => judge.fullTranscript.length > judge.transcript.length), 'Full-turn evidence never grew beyond the recent twenty-second window.');
    assert(entry.judges.some(judge => judge.readings['architecture-astronaut'] >= .8), 'Target never qualified.');
    await cleanupState(page, entry);
    await page.getByRole('button', { name: 'Draw again' }).click();
    await page.getByRole('button', { name: 'Spin for a character' }).waitFor();
    for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await screenshot(`idle-${size.width}`);
      assert(await page.getByRole('button', { name: 'Spin for a character' }).isVisible(), 'Draw action unavailable after resize.');
    }
    entry.passed = true;
  } catch (error) { entry.passed = false; entry.failure = error.message; await screenshot('failure');
    if (await page.getByRole('button', { name: 'Give up', exact: true }).isVisible()) {
      entry.failureCleanup = 'Harness clicked Give up after the failed acceptance deadline.';
      await page.getByRole('button', { name: 'Give up', exact: true }).click();
      await cleanupState(page, entry);
    }
    throw error; }
  finally {
    clearInterval(progressTimer);
    try { entry.capture = await page.evaluate(() => window.__oocHarness()); } catch { /* Closed page. */ }
    await context.close();
  }
}
async function audioGap() {
  const { page, context, entry, screenshot } = await session('missing-input-recovery');
  entry.mocked.push('Disconnect the real media source for four seconds after a positive hold, then reconnect. Worklet, Flux, Luna, and Jev remain real.');
  try {
    await draw(page); await start(page, entry);
    await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 1, undefined, { timeout: 45000 });
    entry.beforeGap = await page.locator('.target-gauge').innerText();
    await screenshot('before-gap');
    await page.evaluate(() => window.__oocDropInput());
    await page.waitForTimeout(5500);
    entry.afterGap = await page.locator('.target-gauge').innerText();
    entry.captionAfterGap = await page.locator('.captions-scroll').innerText();
    await screenshot('after-gap');
    await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 1, undefined, { timeout: 16000 });
    entry.recovered = await page.locator('.target-gauge').innerText();
    await screenshot('recovered');
    await page.getByRole('heading', { name: 'In character.', exact: true }).waitFor({ timeout: 30000 });
    entry.elapsed = await page.locator('.result-stats').innerText();
    await screenshot('won');
    verifySpeech(entry); await cleanupState(page, entry);
    entry.passed = true;
  } catch (error) {
    entry.failure = error.message;
    entry.lastGauge = await page.locator('.target-gauge').innerText().catch(() => '');
    entry.lastCaption = await page.locator('.captions-scroll').innerText().catch(() => '');
    await screenshot('failure');
    if (await page.getByRole('button', { name: 'Give up', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Give up', exact: true }).click();
      await cleanupState(page, entry);
    }
    throw error;
  } finally { await context.close(); }
}
async function failures(includeSpeech = true) {
  if (includesCase('scene-failure')) {
    const { page, context, entry, screenshot } = await session('scene-failure');
    let failed = false;
    await page.route('**/api/scene', async route => {
      if (!failed) { failed = true; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic scene-service failure.' }) }); }
      return route.continue();
    });
    entry.mocked.push('First scene request returns synthetic HTTP 502; retry uses real provider.');
    try {
      await draw(page);
      await page.getByRole('button', { name: 'Retry scene' }).waitFor();
      assert(await page.getByRole('button', { name: 'Start impersonating' }).isDisabled(), 'Scene failure allowed Start.');
      await screenshot('error');
      await page.getByRole('button', { name: 'Retry scene' }).click();
      await page.locator('button:not([disabled])').filter({ hasText: 'Start impersonating' }).waitFor({ timeout: 30000 });
      entry.passed = true;
    } finally { await context.close(); }
  }
  if (includesCase('mic-denial')) {
    const { page, context, entry, screenshot } = await session('mic-denial', true);
    entry.mocked.push(`Browser-only getUserMedia throws NotAllowedError. Scene service ${fixtureScene ? 'is an explicit lifecycle fixture' : 'remains real'}.`);
    try {
      await draw(page); await start(page, entry);
      await page.getByRole('heading', { name: 'Let’s take that again.' }).waitFor({ timeout: 15000 });
      assert(entry.judges.length === 0, 'Denied microphone produced gameplay judgments.');
      await cleanupState(page, entry); await screenshot('interrupted'); entry.passed = true;
    } finally { await context.close(); }
  }
  if (includeSpeech && includesCase('give-up-pending')) {
    const { page, context, entry, screenshot } = await session('give-up-pending');
    let held = false;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/judge', async route => {
      const response = await route.fetch();
      const result = await response.json();
      if (response.ok()) verifyComposite(result);
      entry.delayedServiceResponse = { compositeValidated: response.ok(), status: response.status(), snapshotId: result.snapshotId, readingsCount: Object.keys(result.readings || {}).length, target: result.readings?.['architecture-astronaut'] };
      held = true;
      await gate;
      try { await route.fulfill({ response }); } catch { /* Abort on Give up is expected. */ }
    });
    entry.mocked.push('Real Jev response delayed at browser transport until after Give up; no fabricated readings.');
    try {
      await draw(page); await start(page, entry);
      await page.getByRole('button', { name: 'Give up', exact: true }).waitFor({ timeout: 20000 });
      const deadline = Date.now() + 30000;
      while (!held && Date.now() < deadline) await page.waitForTimeout(100);
      assert(held, 'No real pending Jev response observed.');
      assert(entry.delayedServiceResponse.status === 200 && entry.delayedServiceResponse.compositeValidated && entry.delayedServiceResponse.readingsCount === 42, 'Delayed response was not a valid full-cast Jev result.');
      await page.getByRole('button', { name: 'Give up', exact: true }).click();
      release();
      await page.getByRole('heading', { name: 'Gave up. Fair enough.' }).waitFor();
      await page.waitForTimeout(1500);
      assert(await page.getByRole('heading', { name: 'Gave up. Fair enough.' }).isVisible(), 'Late response changed the terminal outcome.');
      await cleanupState(page, entry); await screenshot('result'); entry.passed = true;
    } finally { release(); await context.close(); }
  }
}
async function captureLifecycle(includeUnchanged = true, includeQuiet = true, includeCancel = true) {
  if (includeUnchanged && includesCase('sound-check')) {
    const { page, context, entry, screenshot } = await session('sound-check');
    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Audio', exact: true }).click();
      await page.getByRole('button', { name: 'Test audio', exact: true }).click();
      await page.getByRole('button', { name: 'Stop test', exact: true }).waitFor({ timeout: 15000 });
      await page.waitForFunction(() => /diagram|checkout|first|propose|context/i.test(document.querySelector('.audio-test-caption')?.textContent || ''), undefined, { timeout: 20000 });
      assert(entry.judges.length === 0, 'Sound check submitted gameplay judgments.');
      await screenshot('recognizing');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await cleanupState(page, entry);
      verifySpeech(entry);
      entry.passed = true;
    } finally { await context.close(); }
  }
  if (includeUnchanged && includeCancel && includesCase('capture-cancel')) {
    const { page, context, entry, screenshot } = await session('capture-cancel');
    entry.mocked.push('Browser-only getUserMedia completion delayed after acquiring a real synthetic stream until after Cancel connection.');
    try {
      await draw(page);
      await page.evaluate(() => window.__oocDelayCapture());
      await start(page, entry);
      await page.getByRole('button', { name: 'Cancel connection', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
      await page.evaluate(() => window.__oocReleaseCapture());
      await page.getByRole('button', { name: 'Spin for a character', exact: true }).waitFor();
      await cleanupState(page, entry);
      assert(entry.judges.length === 0, 'Canceled capture submitted gameplay judgments.');
      assert(entry.sockets.length === 0, 'Canceled permission request opened speech transport.');
      await screenshot('idle'); entry.passed = true;
    } finally { await context.close(); }
  }
  if (includeQuiet && includesCase('quiet-and-background')) {
    const { page, context, entry, screenshot } = await session('quiet-and-background');
    entry.mocked.push('Synthetic microphone tracks disabled after real judgment; document.hidden then overridden to dispatch the visibility boundary in headless browser.');
    try {
      await draw(page); await start(page, entry);
      await page.getByRole('button', { name: 'Give up', exact: true }).waitFor({ timeout: 15000 });
      const deadline = Date.now() + 30000;
      let positiveHold = 0;
      while (Date.now() < deadline) {
        positiveHold = Number(await page.getByRole('progressbar', { name: 'Consecutive scores in the win zone' }).getAttribute('aria-valuenow'));
        if (positiveHold >= 1) break;
        await page.waitForTimeout(100);
      }
      assert(entry.judges.some(judge => judge.readings['architecture-astronaut'] >= .8) && positiveHold >= 1, 'Could not establish a positive real Jev hold before the quiet boundary.');
      entry.positiveHoldBeforeMute = positiveHold;
      await page.evaluate(() => window.__oocMuteFixture());
      await page.waitForTimeout(5000);
      assert(await page.getByRole('button', { name: 'Give up', exact: true }).isVisible(), 'Quiet microphone produced a win.');
      assert(Number(await page.getByRole('progressbar', { name: 'Consecutive scores in the win zone' }).getAttribute('aria-valuenow')) >= positiveHold, 'Quiet microphone lost its saved streak.');
      entry.quietPreserved = { positiveStreakBeforeMute: positiveHold, streakAfterFiveSeconds: Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')), noWin: true };
      await screenshot('quiet');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.getByRole('heading', { name: 'Let’s take that again.' }).waitFor();
      entry.backgroundInterrupted = true;
      await cleanupState(page, entry); await screenshot('background'); entry.passed = true;
    } finally { await context.close(); }
  }
}
try {
  const healthContext = await browser.newContext();
  try {
    const response = await healthContext.request.get(new URL('/api/health', baseUrl).href, { timeout: 10000 });
    report.health = await response.json();
    assert(response.ok() && report.health.castCount === 42 && report.health.speech === 'cloudflare-flux' && report.health.configured?.speech, 'Preview is not the configured 42-character Flux build.');
  } finally { await healthContext.close(); }
  if (mode === 'happy' || mode === 'all' || mode === 'pause') await happy();
  if (mode === 'audio-gap') await audioGap();
  if (mode === 'failures' || mode === 'all' || mode === 'boundaries') await failures();
  if (mode === 'pre-capture-failures') await failures(false);
  if (mode === 'capture-lifecycle' || mode === 'all' || mode === 'boundaries') await captureLifecycle();
  if (mode === 'quiet') await captureLifecycle(false);
  if (mode === 'sound-check') await captureLifecycle(true, false, false);
  assert(report.cases.length > 0, 'Unknown acceptance mode.');
} catch (error) { report.failure = error.message; if (report.cases.at(-1)) { report.cases.at(-1).passed = false; report.cases.at(-1).failure ||= error.message; } process.exitCode = 1; }
finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ cases: report.cases.map(({ name, passed, failure, judges, cleanup }) => ({ name, passed, failure, judgingResponses: judges.length, cleanup })), failure: report.failure }));
