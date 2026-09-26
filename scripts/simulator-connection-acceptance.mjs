import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-engine-r1-before';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const snapshot = (id, status) => ({ id, scenarioId: 'sharepoint', clientId: 'morgan', status, startedAt: Date.now(), limitSeconds: 600, revision: 0, transcript: [], evaluation: null, feedbackStatus: 'waiting', message: null, finalization: status === 'ended' ? 'confirmed' : 'pending', usageSeconds: status === 'ended' ? 2 : null });

try {
  for (const mode of ['explicit-end', 'hard-failure', 'dispose']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await context.addInitScript(() => {
      const NativePeer = RTCPeerConnection;
      const NativeAudioContext = AudioContext;
      const audit = { peers: [], contexts: [], tracks: [], remotes: [], snapshots: [], errors: [] };
      window.__connectionAudit = audit;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) { super(...args); audit.peers.push(this); }
      };
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) { super(...args); audit.contexts.push(this); }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        // A real browser audio track without device permission or a paid provider.
        audit.sourceContext = new NativeAudioContext();
        const destination = audit.sourceContext.createMediaStreamDestination();
        audit.tracks.push(...destination.stream.getTracks());
        return destination.stream;
      };
      window.__answerSimulatorOffer = async offer => {
        const remote = new NativePeer();
        audit.remotes.push(remote);
        await remote.setRemoteDescription({ type: 'offer', sdp: offer });
        await remote.setLocalDescription(await remote.createAnswer());
        if (remote.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Loopback ICE timed out.')), 8000);
          remote.addEventListener('icegatheringstatechange', () => {
            if (remote.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
          });
        });
        return remote.localDescription.sdp;
      };
    });

    let id;
    let releaseEnd;
    let endSeen;
    const endRequest = new Promise(resolve => { endSeen = resolve; });
    await page.route('**/api/simulator/sessions**', async route => {
      const url = new URL(route.request().url());
      const action = url.pathname.split('/').at(-1);
      if (action === 'sessions') {
        const request = route.request().postDataJSON();
        id = request.id;
        const sdp = await page.evaluate(offer => window.__answerSimulatorOffer(offer), request.sdp);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sdp, snapshot: snapshot(id, 'connecting') }) });
      }
      if (action === 'end') {
        endSeen();
        await new Promise(resolve => { releaseEnd = resolve; });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot(id, 'ended')) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot(id, 'live')) });
    });

    try {
      await page.goto(`${base}/simulator`);
      await page.evaluate(async () => {
        const { LiveConnection } = await import('/app/simulator/live-connection.ts');
        const audit = window.__connectionAudit;
        audit.connection = new LiveConnection({ snapshot: value => audit.snapshots.push(value), levels: () => {}, error: (message, fatal) => audit.errors.push({ message, fatal }) });
        void audit.connection.start('sharepoint', 'morgan');
      });
      await page.waitForFunction(() => window.__connectionAudit.snapshots.some(item => item.status === 'live'), null, { timeout: 20_000 });
      if (mode === 'explicit-end') {
        await page.evaluate(() => { void window.__connectionAudit.connection.end(); });
      } else if (mode === 'dispose') {
        await page.evaluate(() => { window.__connectionAudit.connection.dispose(); });
      } else {
        await page.evaluate(() => {
          const peer = window.__connectionAudit.peers[0];
          // Only the failure signal is synthetic. Media, WebRTC negotiation,
          // browser cleanup, and the LiveConnection callback path are real.
          Object.defineProperty(peer, 'connectionState', { configurable: true, get: () => 'failed' });
          peer.dispatchEvent(new Event('connectionstatechange'));
          delete peer.connectionState;
        });
      }
      await Promise.race([endRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('No /end request.')), 5000))]);
      await page.waitForTimeout(1200); // HTTP /end is still held deliberately.
      const pending = await page.evaluate(() => {
        const audit = window.__connectionAudit;
        return { tracksEnded: audit.tracks.every(track => track.readyState === 'ended'), peersClosed: audit.peers.every(peer => peer.signalingState === 'closed'), contextsClosed: audit.contexts.every(context => context.state === 'closed'), fatal: audit.errors.some(error => error.fatal), terminal: audit.snapshots.some(item => item.status === 'ended') };
      });
      releaseEnd();
      if (mode !== 'dispose') await page.waitForFunction(() => window.__connectionAudit.snapshots.some(item => item.status === 'ended'), null, { timeout: 10_000 });
      else await page.waitForTimeout(200);
      const settled = await page.evaluate(() => ({ terminal: window.__connectionAudit.snapshots.at(-1)?.status === 'ended', fatal: window.__connectionAudit.errors.some(error => error.fatal) }));
      const checks = {
        localCleanupBeforeHttpEnd: pending.tracksEnded && pending.peersClosed && pending.contextsClosed,
        fatalBeforeHttpEnd: mode !== 'hard-failure' || pending.fatal,
        terminalSnapshotAfterHttpEnd: mode === 'dispose' ? !settled.terminal : settled.terminal,
        fatalAfterHttpEnd: mode !== 'hard-failure' || settled.fatal,
      };
      results.push({ mode, pass: Object.values(checks).every(Boolean) && !pageErrors.length, checks, pending, settled, pageErrors });
    } catch (error) {
      results.push({ mode, pass: false, error: error.message, pageErrors });
    } finally {
      releaseEnd?.();
      await page.evaluate(async () => {
        const audit = window.__connectionAudit;
        audit.connection?.dispose();
        audit.remotes.forEach(peer => peer.close());
        audit.tracks.forEach(track => track.stop());
        await audit.sourceContext?.close();
      }).catch(() => {});
      await context.close();
    }
  }
} finally { await browser.close(); }

await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ output, results }));
if (results.some(result => !result.pass)) process.exitCode = 1;
