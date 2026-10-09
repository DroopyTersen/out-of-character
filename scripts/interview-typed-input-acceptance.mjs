// Typed input on the real /interview page: composer, LiveConnection, loopback WebRTC and a synthetic microphone track.
// The interview session routes are answered here, so no provider or paid call runs. The dev server must have the
// interview enabled (SIMULATOR_ENABLED, PAID_SERVICES_ENABLED and provider variables set) for Start to be available.
//   ACCEPTANCE_URL=http://127.0.0.1:5173 bun scripts/interview-typed-input-acceptance.mjs
// The first submitText reply is a 503, so the browser's retry with the same id is checked as well.
// Whether later speech merges into a typed passage is decided by the session actor (session.server.test.ts); here the
// poll replies are authored, so the check is only that the page shows them as separate passages.
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/interview-typed-input';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const sessions = '/api/interview/sessions';
const TYPED = 'The handoff took five days and now takes one.';
const SPOKEN = 'And the review step went away entirely.';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
await context.addInitScript(() => {
  const NativePeer = RTCPeerConnection;
  const NativeAudioContext = AudioContext;
  const audit = { tracks: [], remotes: [] };
  window.__typedAudit = audit;
  navigator.mediaDevices.getUserMedia = async () => {
    // A real browser audio track without device permission or a paid provider.
    audit.sourceContext = new NativeAudioContext();
    const destination = audit.sourceContext.createMediaStreamDestination();
    const gain = audit.sourceContext.createGain();
    gain.gain.value = 0;
    const input = audit.sourceContext.createOscillator();
    input.connect(gain).connect(destination);
    input.start();
    audit.tracks.push(...destination.stream.getTracks());
    return destination.stream;
  };
  window.__answerOffer = async offer => {
    const remote = new NativePeer();
    audit.remotes.push(remote);
    await remote.setRemoteDescription({ type: 'offer', sdp: offer });
    const out = audit.sourceContext.createMediaStreamDestination();
    const oscillator = audit.sourceContext.createOscillator();
    const gain = audit.sourceContext.createGain();
    gain.gain.value = 0;
    oscillator.connect(gain).connect(out);
    oscillator.start();
    for (const track of out.stream.getTracks()) remote.addTrack(track, out.stream);
    await remote.setLocalDescription(await remote.createAnswer());
    if (remote.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Loopback ICE timed out.')), 8000);
      remote.addEventListener('icegatheringstatechange', () => { if (remote.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); } });
    });
    return remote.localDescription.sdp;
  };
});

let id;
let transcript = [{ id: 'p1', speaker: 'interviewer', text: 'What changed in the customer handoff?', startMs: 0, endMs: 3000 }];
const polls = [], submissions = [];
let releaseSubmit;
const snapshot = status => ({ id, planId: 'project-closeout', voiceId: 'sam-cedar', status, startedAt: Date.now() - 60_000, limitSeconds: 3600, usageSeconds: null, warning: null, pause: null,
  transcript, evaluation: null, feedbackStatus: 'waiting', background: [], message: null, revision: transcript.length, finalization: 'pending' });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

await page.route(`**${sessions}**`, async route => {
  const action = new URL(route.request().url()).pathname.split('/').at(-1);
  if (action === 'sessions') {
    const request = route.request().postDataJSON();
    id = request.id;
    const sdp = await page.evaluate(offer => window.__answerOffer(offer), request.sdp);
    return json(route, { sdp, snapshot: snapshot('connecting') });
  }
  if (action === 'poll') {
    const activity = route.request().postDataJSON();
    const valid = typeof activity?.active === 'boolean' && typeof activity?.audio === 'boolean' && (activity.composing === undefined || typeof activity.composing === 'boolean') && (activity.sequence === undefined || Number.isSafeInteger(activity.sequence));
    if (!valid) return json(route, { error: 'Invalid activity report.' }, 400);
    polls.push({ ...activity, at: Date.now() });
  }
  if (action === 'submitText') {
    const body = route.request().postDataJSON();
    submissions.push(body);
    // The first save fails; the browser keeps the draft and retries the same id.
    if (submissions.length === 1) return json(route, { error: 'Your answer could not be saved. Try again.' }, 503);
    await new Promise(resolve => { releaseSubmit = resolve; });
    if (!transcript.some(entry => entry.id === `typed-${body.id}`)) transcript = [...transcript, { id: `typed-${body.id}`, speaker: 'participant', text: body.text, startMs: 4000, endMs: 4000 }];
    return json(route, { acceptedId: body.id, snapshot: snapshot('live') });
  }
  if (action === 'end') return json(route, snapshot('ended'));
  return json(route, snapshot('live'));
});

const waitFor = async (predicate, message, ms = 8000) => {
  const expires = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > expires) throw new Error(message);
    await page.waitForTimeout(100);
  }
};
const tracksEnabled = () => page.evaluate(() => window.__typedAudit.tracks.map(track => track.enabled));
const nextPoll = async (after, predicate, message) => {
  await waitFor(() => polls.some(poll => poll.at > after && predicate(poll)), message);
  return polls.find(poll => poll.at > after && predicate(poll));
};

const checks = {};
let failure = null;
try {
  await page.goto(`${base}/interview`, { waitUntil: 'networkidle' });
  const start = page.getByRole('button', { name: 'Start interview' });
  if (await start.isDisabled()) throw new Error('Start interview is disabled; enable the interview on the dev server.');
  await start.click();
  const composer = page.getByRole('textbox', { name: 'Typed answer' });
  await composer.waitFor({ timeout: 20_000 });
  await waitFor(() => composer.isEnabled(), 'The composer did not become available.', 20_000);
  checks.micOnBeforeTyping = (await tracksEnabled()).every(Boolean);

  // (a) A draft reports composing at once, numbered, and mutes the microphone track.
  const typedAt = Date.now();
  await composer.fill(TYPED);
  const composingPoll = await nextPoll(typedAt, poll => poll.composing === true, 'No poll reported composing: true.');
  checks.composingPollSequenced = Number.isSafeInteger(composingPoll.sequence);
  checks.micOffWhileComposing = (await tracksEnabled()).every(enabled => enabled === false);

  // (b) Send keeps the draft through a failed save and its retry, and clears it only after the 200.
  await page.getByRole('button', { name: 'Send' }).click();
  await waitFor(() => submissions.length >= 2 && releaseSubmit, 'The submission was not retried.', 15_000);
  checks.retrySameId = submissions[0].id === submissions[1].id && /^[0-9a-f-]{36}$/.test(submissions[0].id) && submissions[1].text === TYPED;
  checks.draftKeptWhilePending = await composer.inputValue() === TYPED;
  checks.micOffWhilePending = (await tracksEnabled()).every(enabled => enabled === false);
  const acceptedAt = Date.now();
  releaseSubmit();
  await waitFor(async () => await composer.inputValue() === '', 'The draft was not cleared after the 200.');
  checks.draftClearedAfterAccept = true;

  // (d) The track follows the manual preference again and the next report says composing: false.
  await waitFor(async () => (await tracksEnabled()).every(Boolean), 'The microphone track was not re-enabled.');
  checks.micOnAfterSend = true;
  const released = await nextPoll(acceptedAt, poll => poll.composing === false, 'No poll reported composing: false.');
  checks.composingFalseAfterSend = released.sequence > composingPoll.sequence;

  // (c) The typed passage renders; a later speech passage renders as its own entry.
  await page.getByRole('button', { name: 'Transcript' }).click();
  const panel = page.locator('#interview-live-transcript');
  await panel.getByText(TYPED, { exact: true }).waitFor();
  checks.typedPassageId = transcript.some(entry => entry.id === `typed-${submissions[1].id}`);
  transcript = [...transcript, { id: 'p3', speaker: 'participant', text: SPOKEN, startMs: 5000, endMs: 7000 }];
  await panel.getByText(SPOKEN, { exact: true }).waitFor();
  checks.speechSeparateFromTyped = await panel.locator('article[data-speaker="participant"]').count() === 2 && await panel.getByText(TYPED, { exact: true }).count() === 1;
} catch (error) {
  failure = error.message;
} finally {
  releaseSubmit?.();
  await page.evaluate(() => {
    const audit = window.__typedAudit;
    audit?.remotes.forEach(peer => peer.close());
    audit?.tracks.forEach(track => track.stop());
    void audit?.sourceContext?.close();
  }).catch(() => {});
  await context.close();
  await browser.close();
}

const result = { pass: !failure && !pageErrors.length && Object.values(checks).every(Boolean), checks, failure, pageErrors, submissions, polls: polls.map(({ at, ...poll }) => poll) };
await writeFile(`${output}/report.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, pass: result.pass, checks, failure, pageErrors }));
if (!result.pass) process.exitCode = 1;
