import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
if (!process.argv.includes('--paid')) throw new Error('This runs one paid Live attempt. Pass --paid explicitly.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = resolve(process.env.ACCEPTANCE_OUTPUT || 'output/simulator-live');
await mkdir(output, { recursive: true });
const audio = await readFile(resolve(process.env.ACCEPTANCE_AUDIO || 'output/simulator-fixture.wav'));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const viewport = process.env.ACCEPTANCE_PHONE === '1' ? { width: 390, height: 844 } : { width: 1440, height: 960 };
const context = await browser.newContext({ viewport, permissions: ['microphone'] });
await context.route('**/__simulator_fixture.wav', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: audio }));
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const report = { at: new Date().toISOString(), baseUrl, synthetic: true, viewport, checks: [], snapshots: [], errors: [] };
let retriedPoll = false;
await context.route('**/api/simulator/sessions/*/poll', route => {
  if (!retriedPoll) { retriedPoll = true; return route.fulfill({ status: 503, contentType: 'text/html', body: 'Temporary upstream failure' }); }
  return route.continue();
});
await context.addInitScript(() => {
  const tracks = [], peers = [], events = [];
  const OriginalPeer = RTCPeerConnection;
  window.RTCPeerConnection = class extends OriginalPeer {
    constructor(...args) { super(...args); peers.push(this); }
    createDataChannel(...args) { const channel = super.createDataChannel(...args); channel.addEventListener('message', event => { try { events.push(JSON.parse(event.data)); } catch {} }); return channel; }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const destination = ctx.createMediaStreamDestination();
    const response = await fetch('/__simulator_fixture.wav');
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(destination);
    source.start(ctx.currentTime + 8);
    tracks.push(...destination.stream.getTracks());
    return destination.stream;
  };
  window.__simulatorSmoke = { tracks, peers, events };
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', async response => {
  if (response.url().includes('/api/simulator/sessions')) {
    try {
      const value = await response.json();
      if (value.snapshot) report.snapshots.push(value.snapshot);
      else if (value.id) report.snapshots.push(value);
      else if (value.error) report.errors.push(value.error);
    } catch {}
  }
});
try {
  await page.goto(`${baseUrl}/simulator`);
  await page.getByRole('button', { name: 'Start simulation' }).click();
  await page.getByRole('button', { name: 'End session', exact: true }).waitFor({ timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector('.sim-caption')?.textContent?.includes('Client') || document.querySelector('.sim-caption small')?.textContent === 'Morgan', null, { timeout: 25_000 });
  await page.waitForTimeout(24_000);
  await page.waitForFunction(() => [...document.querySelectorAll('.sim-skill strong')].some(node => /^\d\.\d$/.test(node.textContent)), null, { timeout: 25_000 });
  await page.getByText('Jev · live', { exact: true }).waitFor({ timeout: 25_000 });
  await page.waitForTimeout(800); // Let the visible score transition finish before capturing it.
  await page.screenshot({ path: `${output}/live.png`, fullPage: true });
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('heading', { name: 'Your session debrief', exact: true }).waitFor({ timeout: 35_000 });
  report.browser = await page.evaluate(async () => {
    const audit = window.__simulatorSmoke;
    // Only the provider's data-channel permission notice is expected. Checking
    // the exact event shape rejects nested config rather than a few field names.
    const publicNotice = event => event.type === 'info' && event.code === 'data_channel_permissions'
      && Object.keys(event).every(key => ['type', 'event_id', 'code', 'message', 'client_event_id'].includes(key))
      && typeof event.message === 'string' && /data.channel|permission|allow/i.test(event.message);
    return { tracksEnded: audit.tracks.every(track => track.readyState === 'ended'), peersClosed: audit.peers.every(peer => peer.connectionState === 'closed'), dataChannelEvents: audit.events.map(event => ({ type: event.type, code: event.code, messageLength: event.message?.length })), privateConfigReceived: audit.events.some(event => !publicNotice(event)) };
  });
  const last = report.snapshots.at(-1);
  report.checks = [
    { name: 'provider closure confirmed', passed: last?.finalization === 'confirmed' },
    { name: 'trainee transcript', passed: last?.transcript.some(item => item.speaker === 'trainee') ?? false },
    { name: 'client transcript', passed: last?.transcript.some(item => item.speaker === 'client') ?? false },
    { name: 'real Jev evaluation', passed: last?.evaluation?.model?.includes('jev') ?? false },
    { name: 'Jev feedback while conversation is live', passed: report.snapshots.some(snapshot => snapshot.status === 'live' && snapshot.evaluation?.model?.includes('jev')) },
    { name: 'current live assessment after speech settles', passed: report.snapshots.some(snapshot => snapshot.status === 'live' && snapshot.feedbackStatus === 'current') },
    { name: 'one transient polling failure recovers', passed: retriedPoll && report.snapshots.some(snapshot => snapshot.status === 'live' && snapshot.revision > 0) },
    { name: 'local media cleanup', passed: report.browser.tracksEnded && report.browser.peersClosed },
    { name: 'private data-channel configuration excluded', passed: !report.browser.privateConfigReceived },
  ];
  await page.screenshot({ path: `${output}/debrief.png`, fullPage: true });
} catch (error) {
  report.errors.push(error.message);
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  const end = page.getByRole('button', { name: /^(End session|Cancel)$/ });
  if (await end.count()) await end.click().catch(() => {});
  await page.waitForTimeout(1500);
} finally {
  await context.close(); await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, checks: report.checks, errors: report.errors }));
if (report.errors.length || report.checks.some(check => !check.passed) || !report.checks.length) process.exitCode = 1;
