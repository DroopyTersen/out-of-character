import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5174';
const output = resolve(process.env.ACCEPTANCE_OUTPUT || 'output/interview-streaming/browser/live');
await mkdir(output, { recursive: true });

const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', '180', '-o', `${output}/participant.aiff`,
  'Hi Sam. We built a permit intake portal. I led the integrations, and a client operations manager helped resolve an access handoff.'], { stderr: 'ignore' });
if (await speech.exited) throw new Error('Synthetic speech fixture could not be created.');
const convert = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-i', `${output}/participant.aiff`, '-ar', '24000', '-ac', '1', `${output}/participant.wav`], { stderr: 'ignore' });
if (await convert.exited) throw new Error('Synthetic speech fixture could not be converted.');
const fixture = await readFile(`${output}/participant.wav`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route('**/__interview_fixture.wav', route => route.fulfill({ contentType: 'audio/wav', body: fixture }));
await context.addInitScript(() => {
  const NativePeer = RTCPeerConnection;
  const audit = { peak: 0, remoteTracks: 0, fixturePlayed: false, media: null };
  window.__interviewAudit = audit;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) {
      super(...args);
      audit.peer = this;
      this.addEventListener('track', event => {
        audit.remoteTracks++;
        audit.media = { kind: event.track.kind, state: event.track.readyState, muted: event.track.muted };
        const meterContext = new AudioContext();
        const analyser = meterContext.createAnalyser();
        const stream = event.streams[0] || new MediaStream([event.track]);
        meterContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => {
          if (event.track.readyState === 'ended') { clearInterval(timer); void meterContext.close(); return; }
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          audit.peak = Math.max(audit.peak, rms);
          audit.media = { kind: event.track.kind, state: event.track.readyState, muted: event.track.muted };
        }, 100);
        void meterContext.resume();
      });
    }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    const silence = context.createGain();
    silence.gain.value = 0;
    oscillator.connect(silence).connect(destination);
    oscillator.start();
    await context.resume();
    audit.sourceContext = context;
    audit.sourceTrack = destination.stream.getAudioTracks()[0];
    audit.playFixture = async () => {
      const data = await fetch('/__interview_fixture.wav').then(response => response.arrayBuffer());
      const buffer = await context.decodeAudioData(data);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      audit.fixturePlayed = true;
      await new Promise(resolve => { source.onended = resolve; source.start(); });
    };
    return destination.stream;
  };
});

const page = await context.newPage();
const report = { checkedAt: new Date().toISOString(), route: '/interview', voice: 'sam-gleam', syntheticMicrophone: true, fixturePlayed: false, opening: false, openingText: '', audiblePeak: 0, snapshots: [], requests: [], reportStream: null, finalization: null, summary: null, resources: null, errors: [] };
const snapshots = report.snapshots;
let lastClientText = '';
let lastClientChangeAt = 0;
let firstClientAt = 0;
let ownedSession;
page.on('pageerror', error => report.errors.push(`Page error: ${error.message}`));
page.on('request', request => {
  if (!new URL(request.url()).pathname.startsWith('/api/simulator/sessions')) return;
  const action = new URL(request.url()).pathname.split('/').at(-1);
  report.requests.push({ action });
  if (action === 'sessions') ownedSession = { id: request.postDataJSON()?.id, capability: request.headers().authorization };
});
page.on('response', async response => {
  if (!/^\/api\/simulator\/sessions(?:\/|$)/.test(new URL(response.url()).pathname)) return;
  const action = new URL(response.url()).pathname.split('/').at(-1);
  const request = report.requests.findLast(item => item.action === action && item.status == null);
  if (request) request.status = response.status();
  if (action === 'report') {
    report.reportStream = { status: response.status(), contentType: response.headers()['content-type'] || null };
    if (!response.ok()) report.errors.push(`Summary stream could not start (${response.status()}).`);
    return;
  }
  try {
    const body = await response.json();
    const snapshot = body.snapshot || body;
    if (!snapshot?.status) { if (!response.ok()) report.errors.push(`Session request failed (${response.status()}).`); return; }
    snapshots.push({ source: action, status: snapshot.status, finalization: snapshot.finalization, transcript: snapshot.transcript?.map(({ speaker, text }) => ({ speaker, text })) || [], summary: snapshot.interview?.summary || null, reportState: snapshot.report?.status || null, reportText: snapshot.report?.status === 'completed' ? snapshot.report.report.text : null });
    const clientText = snapshot.transcript?.filter(entry => entry.speaker === 'client').map(entry => entry.text).join(' ') || '';
    if (clientText !== lastClientText) {
      lastClientText = clientText;
      lastClientChangeAt = Date.now();
      if (clientText && !firstClientAt) firstClientAt = lastClientChangeAt;
    }
  } catch { report.errors.push(`Session response could not be read (${response.status()}).`); }
});

const waitUntil = async (check, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= until) return false;
    await page.waitForTimeout(200);
  }
  return true;
};

let startedAt = 0;
try {
  await page.goto(`${base}/interview`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Female voice', exact: true }).click();
  await page.getByRole('button', { name: 'Start interview' }).click();
  startedAt = Date.now();
  if (!await waitUntil(() => snapshots.some(item => item.status === 'live'), 20_000)) throw new Error('Interview did not become live.');
  report.opening = await waitUntil(() => snapshots.some(item => item.transcript.some(entry => entry.speaker === 'client')) || false, Math.max(0, 30_000 - (Date.now() - startedAt)));
  if (report.opening) {
    const settled = await waitUntil(() => Date.now() - firstClientAt >= 5_000 && Date.now() - lastClientChangeAt >= 1_800, Math.max(0, 30_000 - (Date.now() - startedAt)));
    report.openingText = lastClientText.trim();
    if (!settled) throw new Error('Opening did not settle within 30 seconds.');
  }
  const beforeInput = await page.evaluate(() => ({ peak: window.__interviewAudit.peak, remoteTracks: window.__interviewAudit.remoteTracks, media: window.__interviewAudit.media }));
  report.audiblePeak = beforeInput.peak;
  report.remoteTracks = beforeInput.remoteTracks;
  report.remoteMedia = beforeInput.media;

  // The same synthetic audio checks whether a silent opening can still respond to input.
  await page.evaluate(() => window.__interviewAudit.playFixture());
  report.fixturePlayed = true;
  await waitUntil(() => snapshots.some(item => item.transcript.some(entry => entry.speaker === 'trainee')), Math.max(0, 60_000 - (Date.now() - startedAt)));
  await waitUntil(() => snapshots.some(item => item.transcript.filter(entry => entry.speaker === 'client').length >= (report.opening ? 2 : 1)) && Date.now() - lastClientChangeAt >= 1800, Math.max(0, 60_000 - (Date.now() - startedAt)));
  report.liveSeconds = Math.round((Date.now() - startedAt) / 1000);
  report.clientNotices = await page.locator('.sim-notice').allTextContents();
} catch (error) { report.errors.push(error.message); }
finally {
  try {
    await page.getByRole('button', { name: 'End interview', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    let ended = await waitUntil(() => snapshots.some(item => item.status === 'ended' || item.status === 'interrupted'), 30_000);
    if (!ended && ownedSession?.id && ownedSession.capability) {
      const response = await fetch(`${base}/api/simulator/sessions/${ownedSession.id}/end`, { method: 'POST', headers: { Origin: base, Authorization: ownedSession.capability } });
      const snapshot = await response.json();
      if (snapshot?.status) snapshots.push({ source: 'manual-end', status: snapshot.status, finalization: snapshot.finalization, transcript: snapshot.transcript?.map(({ speaker, text }) => ({ speaker, text })) || [], summary: snapshot.interview?.summary || null, reportState: snapshot.report?.status || null, reportText: snapshot.report?.status === 'completed' ? snapshot.report.report.text : null });
      ended = snapshot?.status === 'ended' || snapshot?.status === 'interrupted';
    }
    if (!ended) report.errors.push('No terminal session snapshot within 30 seconds of End.');
    const last = snapshots.at(-1);
    report.finalization = last?.finalization || null;
    await waitUntil(() => snapshots.some(item => ['completed', 'failed', 'ineligible'].includes(item.reportState)), 135_000);
    const final = snapshots.findLast(item => ['completed', 'failed', 'ineligible'].includes(item.reportState));
    report.summary = final ? { status: final.reportState, text: final.reportText } : null;
    report.summaryPollConfirmed = final?.source === 'poll';
    report.audiblePeak = await page.evaluate(() => window.__interviewAudit?.peak || 0).catch(() => report.audiblePeak);
    report.resources = await page.evaluate(() => ({ microphone: window.__interviewAudit?.sourceTrack?.readyState, peer: window.__interviewAudit?.peer?.signalingState })).catch(() => null);
    report.sessionId = ownedSession?.id || null;
  } catch (error) { report.errors.push(`Closure check failed: ${error.message}`); }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await context.close();
  await browser.close();
}

const participantHeard = snapshots.some(item => item.transcript.some(entry => entry.speaker === 'trainee' && entry.text.trim()));
const passed = report.opening && report.audiblePeak > 0.005 && participantHeard && report.finalization === 'confirmed' && report.reportStream?.status === 200 && report.summaryPollConfirmed && report.summary?.status === 'completed' && Boolean(report.summary.text?.trim()) && report.resources?.microphone === 'ended' && report.resources?.peer === 'closed' && !report.errors.length;
console.log(JSON.stringify({ output, passed, opening: report.openingText, audiblePeak: report.audiblePeak, fixturePlayed: report.fixturePlayed, finalization: report.finalization, summaryStatus: report.summary?.status || null, resources: report.resources, errors: report.errors }));
if (!passed) process.exitCode = 1;
