import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { isBackchannel } from '../core/interview.ts';

const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5174';
const output = resolve(process.env.ACCEPTANCE_OUTPUT || 'output/interview-streaming/browser/live');
const minimumLiveMs = Number(process.env.ACCEPTANCE_MIN_LIVE_MS || 0);
await mkdir(output, { recursive: true });

const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', '180', '-o', `${output}/participant.aiff`,
  process.env.ACCEPTANCE_PARTICIPANT || 'Hi Sam. We built a permit intake portal. I led the integrations, and a client operations manager helped resolve an access handoff.'], { stderr: 'ignore' });
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
          if (rms > .005 && audit.fixturePlayed && !audit.fixtureEndedAt) audit.samAudibleDuringFixture = true;
          if (rms > .005 && audit.fixtureEndedAt && !audit.firstReplyAudioAt) audit.firstReplyAudioAt = Date.now();
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
      await new Promise(resolve => { source.onended = () => { audit.fixtureEndedAt = Date.now(); resolve(); }; source.start(); });
    };
    return destination.stream;
  };
});

const page = await context.newPage();
const report = { checkedAt: new Date().toISOString(), route: '/interview', voice: 'sam-gleam', voiceClickAttempts: 0, syntheticMicrophone: true, fixturePlayed: false, opening: false, openingText: '', audiblePeak: 0, reply: false, firstAudibleAfterFixtureMs: null, samAudibleDuringFixture: false, snapshots: [], requests: [], microphone: { polledAfterMute: false, trackMuted: false, polledAfterUnmute: false }, reportStream: null, finalization: null, summary: null, resources: null, errors: [] };
const snapshots = report.snapshots;
let lastClientText = '';
let lastClientChangeAt = 0;
let firstClientAt = 0;
let ownedSession;
page.on('pageerror', error => report.errors.push(`Page error: ${error.message}`));
page.on('request', request => {
  if (!new URL(request.url()).pathname.startsWith('/api/interview/sessions')) return;
  const action = new URL(request.url()).pathname.split('/').at(-1);
  report.requests.push({ action, ...(action === 'poll' ? { activity: request.postDataJSON() } : {}) });
  if (action === 'sessions') ownedSession = { id: request.postDataJSON()?.id, capability: request.headers().authorization };
});
page.on('response', async response => {
  if (!/^\/api\/interview\/sessions(?:\/|$)/.test(new URL(response.url()).pathname)) return;
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
    snapshots.push({ source: action, status: snapshot.status, finalization: snapshot.finalization, transcript: snapshot.transcript?.map(({ speaker, text, startMs, endMs }) => ({ speaker, text, startMs, endMs })) || [], summary: snapshot.interview?.summary || null, reportState: snapshot.report?.status || null, reportText: snapshot.report?.status === 'completed' ? snapshot.report.report.text : null });
    const clientText = snapshot.transcript?.filter(entry => entry.speaker === 'interviewer').map(entry => entry.text).join(' ') || '';
    if (clientText !== lastClientText) {
      lastClientText = clientText;
      lastClientChangeAt = Date.now();
      if (clientText && !firstClientAt) firstClientAt = lastClientChangeAt;
    }
  } catch { report.errors.push(`Session response could not be read (${response.status()}).`); }
});

const waitUntil = async (check, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (!await check()) {
    if (Date.now() >= until) return false;
    await page.waitForTimeout(200);
  }
  return true;
};

let startedAt = 0;
try {
  await page.goto(`${base}/interview`, { waitUntil: 'networkidle' });
  const female = page.getByRole('button', { name: 'Female voice', exact: true });
  const selected = page.getByRole('button', { name: 'Female voice', exact: true, pressed: true });
  const voiceDeadline = Date.now() + 10_000;
  while (!await selected.isVisible()) {
    if (Date.now() >= voiceDeadline) throw new Error('Female voice was not selected within 10 seconds.');
    await female.click({ timeout: 2_000 });
    report.voiceClickAttempts++;
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: 'Start interview' }).click();
  startedAt = Date.now();
  if (!await waitUntil(() => snapshots.some(item => item.status === 'live'), 20_000)) throw new Error('Interview did not become live.');
  report.opening = await waitUntil(() => snapshots.some(item => item.transcript.some(entry => entry.speaker === 'interviewer')) || false, Math.max(0, 30_000 - (Date.now() - startedAt)));
  if (report.opening) {
    const settled = await waitUntil(() => Date.now() - firstClientAt >= 5_000 && Date.now() - lastClientChangeAt >= 1_800, Math.max(0, 30_000 - (Date.now() - startedAt)));
    report.openingText = lastClientText.trim();
    if (!settled) throw new Error('Opening did not settle within 30 seconds.');
  }
  const beforeInput = await page.evaluate(() => ({ peak: window.__interviewAudit.peak, remoteTracks: window.__interviewAudit.remoteTracks, media: window.__interviewAudit.media }));
  report.audiblePeak = beforeInput.peak;
  report.remoteTracks = beforeInput.remoteTracks;
  report.remoteMedia = beforeInput.media;

  const polls = () => report.requests.filter(item => item.action === 'poll').map(item => item.activity);
  const beforeMuteSequence = polls().at(-1)?.sequence ?? -1;
  await page.getByRole('button', { name: 'Mic on', exact: true }).click();
  const polledAfterMute = await waitUntil(() => polls().some(item => item.sequence > beforeMuteSequence), 5000);
  const trackMuted = await page.evaluate(() => !window.__interviewAudit.sourceTrack.enabled);
  const beforeUnmuteSequence = polls().at(-1)?.sequence ?? -1;
  await page.getByRole('button', { name: 'Mic off', exact: true }).click();
  const polledAfterUnmute = await waitUntil(() => polls().some(item => item.sequence > beforeUnmuteSequence), 5000);
  const trackUnmuted = await page.evaluate(() => window.__interviewAudit.sourceTrack.enabled);
  report.microphone = { polledAfterMute, trackMuted, polledAfterUnmute, trackUnmuted };
  if (!polledAfterMute || !trackMuted || !polledAfterUnmute || !trackUnmuted) throw new Error('Polling or microphone mute/unmute failed.');

  // The same synthetic audio checks whether a silent opening can still respond to input.
  await page.evaluate(() => window.__interviewAudit.playFixture());
  report.fixturePlayed = true;
  if (!await waitUntil(() => snapshots.some(item => item.transcript.some(entry => entry.speaker === 'participant' && entry.text.trim())), Math.max(0, 60_000 - (Date.now() - startedAt)))) throw new Error('Participant audio was not transcribed.');
  report.reply = await waitUntil(async () => {
    const transcript = snapshots.at(-1)?.transcript || [];
    const participantEnd = Math.max(...transcript.filter(entry => entry.speaker === 'participant').map(entry => entry.endMs));
    return transcript.some(entry => entry.speaker === 'interviewer' && entry.endMs > participantEnd && entry.text.trim() && !isBackchannel(entry.text)) && Date.now() - lastClientChangeAt >= 1800
      && await page.evaluate(() => Boolean(window.__interviewAudit.firstReplyAudioAt));
  }, Math.max(0, 60_000 - (Date.now() - startedAt)));
  if (!report.reply) throw new Error('No audible Sam reply after the participant answer.');
  report.firstAudibleAfterFixtureMs = await page.evaluate(() => window.__interviewAudit.firstReplyAudioAt - window.__interviewAudit.fixtureEndedAt);
  report.samAudibleDuringFixture = await page.evaluate(() => Boolean(window.__interviewAudit.samAudibleDuringFixture));
  if (minimumLiveMs) await waitUntil(() => Date.now() - startedAt >= minimumLiveMs || report.errors.length || snapshots.some(item => ['ended', 'interrupted'].includes(item.status)), minimumLiveMs);
  report.liveSeconds = Math.round((Date.now() - startedAt) / 1000);
  if (snapshots.some(item => ['ended', 'interrupted'].includes(item.status))) throw new Error('Session ended before End interview was selected.');
  report.clientNotices = await page.locator('.sim-notice').allTextContents();
} catch (error) { report.errors.push(error.message); }
finally {
  try {
    // Summary status uses an unmetered poll after End. Audit only live activity reports.
    const sequences = report.requests.filter(item => item.action === 'poll').map(item => item.activity.sequence);
    report.microphone.sequenceOrdered = sequences.every((value, index) => Number.isInteger(value) && (!index || value > sequences[index - 1]));
    if (!report.microphone.sequenceOrdered) report.errors.push('Activity reports did not have increasing sequence numbers.');
    if (ownedSession?.id) {
      await page.getByRole('button', { name: 'End interview', exact: true }).click({ timeout: 2_000 }).catch(() => report.errors.push('End interview button did not complete.'));
      let ended = await waitUntil(() => snapshots.some(item => item.status === 'ended' || item.status === 'interrupted'), 30_000);
      if (!ended) report.errors.push('The page did not confirm End within 30 seconds.');
      if (!ended && ownedSession.capability) {
        const response = await fetch(`${base}/api/interview/sessions/${ownedSession.id}/end`, { method: 'POST', headers: { Origin: base, Authorization: ownedSession.capability } });
        const snapshot = await response.json();
        if (snapshot?.status) snapshots.push({ source: 'manual-end', status: snapshot.status, finalization: snapshot.finalization, transcript: snapshot.transcript?.map(({ speaker, text, startMs, endMs }) => ({ speaker, text, startMs, endMs })) || [], summary: snapshot.interview?.summary || null, reportState: snapshot.report?.status || null, reportText: snapshot.report?.status === 'completed' ? snapshot.report.report.text : null });
        ended = snapshot?.status === 'ended' || snapshot?.status === 'interrupted';
      }
      if (!ended) report.errors.push('No terminal session snapshot within 30 seconds of End.');
      const last = snapshots.at(-1);
      report.finalization = last?.finalization || null;
      await waitUntil(() => snapshots.some(item => ['completed', 'failed', 'ineligible'].includes(item.reportState)), 135_000);
      const final = snapshots.findLast(item => ['completed', 'failed', 'ineligible'].includes(item.reportState));
      report.summary = final ? { status: final.reportState, text: final.reportText } : null;
      report.summaryPollConfirmed = final?.source === 'poll';
    } else {
      report.errors.push('No session was attempted; End and summary checks were skipped.');
    }
    report.audiblePeak = await page.evaluate(() => window.__interviewAudit?.peak || 0).catch(() => report.audiblePeak);
    report.resources = await page.evaluate(() => ({ microphone: window.__interviewAudit?.sourceTrack?.readyState, peer: window.__interviewAudit?.peer?.signalingState })).catch(() => null);
    report.sessionId = ownedSession?.id || null;
  } catch (error) { report.errors.push(`Closure check failed: ${error.message}`); }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await context.close();
  await browser.close();
}

const participantHeard = snapshots.some(item => item.transcript.some(entry => entry.speaker === 'participant' && entry.text.trim()));
const passed = report.opening && report.audiblePeak > 0.005 && participantHeard && report.reply && report.finalization === 'confirmed' && report.reportStream?.status === 200 && report.summaryPollConfirmed && report.summary?.status === 'completed' && Boolean(report.summary.text?.trim()) && report.resources?.microphone === 'ended' && report.resources?.peer === 'closed' && !report.errors.length;
console.log(JSON.stringify({ output, passed, opening: report.openingText, audiblePeak: report.audiblePeak, fixturePlayed: report.fixturePlayed, reply: report.reply, firstAudibleAfterFixtureMs: report.firstAudibleAfterFixtureMs, samAudibleDuringFixture: report.samAudibleDuringFixture, finalization: report.finalization, summaryStatus: report.summary?.status || null, resources: report.resources, errors: report.errors }));
if (!passed) process.exitCode = 1;
