import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-engine-r1-before';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const baseSnapshot = (id, status) => ({ id, scenarioId: 'sharepoint', clientId: 'morgan', status, startedAt: Date.now(), limitSeconds: 3600, warning: null, revision: 0, transcript: [], evaluation: null, feedbackStatus: 'waiting', message: null, finalization: status === 'ended' ? 'confirmed' : 'pending', usageSeconds: status === 'ended' ? 2 : null });

try {
  const modes = process.env.ACCEPTANCE_MODES?.split(',') ?? ['explicit-end', 'hard-failure', 'dispose', 'dispose-during-end', 'activity', 'server-ending', 'interview-end', 'interview-auto'];
  for (const mode of modes) {
    console.log(`Checking ${mode}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await context.addInitScript(() => {
      const NativePeer = RTCPeerConnection;
      const NativeAudioContext = AudioContext;
      const audit = { peers: [], contexts: [], tracks: [], remotes: [], snapshots: [], errors: [], players: [] };
      const NativeAudio = Audio;
      window.Audio = class extends NativeAudio { constructor(...args) { super(...args); audit.players.push(this); } };
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
        audit.inputGain = audit.sourceContext.createGain();
        audit.inputGain.gain.value = 0;
        const input = audit.sourceContext.createOscillator();
        input.connect(audit.inputGain).connect(destination);
        input.start();
        audit.tracks.push(...destination.stream.getTracks());
        return destination.stream;
      };
      window.__answerSimulatorOffer = async offer => {
        const remote = new NativePeer();
        audit.remotes.push(remote);
        await remote.setRemoteDescription({ type: 'offer', sdp: offer });
        const output = audit.sourceContext.createMediaStreamDestination();
        audit.outputGain = audit.sourceContext.createGain();
        audit.outputGain.gain.value = 0;
        const oscillator = audit.sourceContext.createOscillator();
        oscillator.connect(audit.outputGain).connect(output);
        oscillator.start();
        for (const track of output.stream.getTracks()) remote.addTrack(track, output.stream);
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
    let automaticFinish = false, automaticEnding = false, automaticEnded = false;
    const interview = mode.startsWith('interview-');
    // The interview modes run against the interview's session routes; the rest against the practice simulator's.
    const sessions = interview ? '/api/interview/sessions' : '/api/simulator/sessions';
    const snapshot = (id, status) => ({ ...baseSnapshot(id, status), ...(interview ? { scenarioId: 'project-closeout', clientId: 'sam-cedar', interview: { evaluation: null, summary: status === 'ended' ? { status: 'pending', text: null } : null } } : {}) });
    const capabilities = new Set();
    const activityPolls = [];
    let releaseEnd;
    let endRequests = 0;
    let endSeen;
    const endRequest = new Promise(resolve => { endSeen = resolve; });
    await page.route(`**${sessions}**`, async route => {
      const url = new URL(route.request().url());
      const action = url.pathname.split('/').at(-1);
      capabilities.add(route.request().headers().authorization);
      if (action === 'sessions') {
        const request = route.request().postDataJSON();
        id = request.id;
        const sdp = await page.evaluate(offer => window.__answerSimulatorOffer(offer), request.sdp);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sdp, snapshot: snapshot(id, 'connecting') }) });
      }
      if (action === 'end') {
        endRequests++;
        endSeen();
        if (interview) { automaticEnded = true; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot(id, 'ended')) }); }
        if (mode === 'activity' || mode === 'server-ending') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot(id, 'ended')) });
        await new Promise(resolve => { releaseEnd = resolve; });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot(id, 'ended')) });
      }
      if (action === 'poll') {
        const activity = route.request().postDataJSON();
        if (typeof activity?.active !== 'boolean' || typeof activity?.audio !== 'boolean') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid activity report.' }) });
        activityPolls.push(activity);
      }
      const value = snapshot(id, automaticEnded ? 'ended' : automaticEnding ? 'ending' : 'live');
      if (automaticFinish) value.warning = { kind: 'limit', endsAt: Date.now() - 1000 };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    });

    try {
      await page.goto(`${base}/simulator`, { waitUntil: 'networkidle' });
      await page.evaluate(async ({ interview, sessions }) => {
        const { LiveConnection } = await import('/interview-engine/client/liveConnection.ts');
        const { pollTransport } = await import('/interview-engine/client/transport.ts');
        const audit = window.__connectionAudit;
        audit.connection = new LiveConnection(pollTransport(sessions), { snapshot: value => audit.snapshots.push(value), levels: () => {}, error: (message, fatal) => audit.errors.push({ message, fatal }) });
        void audit.connection.start(interview ? 'project-closeout' : 'sharepoint', interview ? 'sam-cedar' : 'morgan');
      }, { interview, sessions });
      await page.waitForFunction(() => window.__connectionAudit.snapshots.some(item => item.status === 'live'), null, { timeout: 20_000 });
      if (interview) {
        if (mode === 'interview-auto') automaticEnded = true;
        else await page.evaluate(() => window.__connectionAudit.connection.end());
        await page.waitForFunction(() => window.__connectionAudit.snapshots.at(-1)?.interview?.summary?.status === 'pending' && window.__connectionAudit.tracks.every(track => track.readyState === 'ended'));
        const closedBeforeSummary = await page.evaluate(() => {
          const audit = window.__connectionAudit;
          return audit.peers.every(peer => peer.signalingState === 'closed') && audit.contexts.every(context => context.state === 'closed');
        });
        const pollsAtEnd = activityPolls.length;
        await page.waitForTimeout(1300);
        const final = await page.evaluate(() => ({ status: window.__connectionAudit.snapshots.at(-1)?.interview?.summary?.status, fatal: window.__connectionAudit.errors.some(error => error.fatal) }));
        const checks = { mediaClosedWhilePending: closedBeforeSummary, sameCapability: capabilities.size === 1 && /^Bearer [a-f0-9]{64}$/.test([...capabilities][0]), noFatalError: !final.fatal, noExtraClosure: endRequests === (mode === 'interview-auto' ? 0 : 1), voiceConnectionDoesNotPollSummary: activityPolls.length === pollsAtEnd && final.status === 'pending' };
        results.push({ mode, pass: Object.values(checks).every(Boolean) && !pageErrors.length, checks, final, pageErrors });
        continue;
      }
      if (mode === 'server-ending') {
        const micWasEnabled = await page.evaluate(() => window.__connectionAudit.tracks.every(track => track.enabled));
        automaticEnding = true;
        await page.waitForFunction(() => window.__connectionAudit.snapshots.at(-1)?.status === 'ending' && window.__connectionAudit.tracks.every(track => !track.enabled));
        automaticEnded = true;
        await page.waitForFunction(() => window.__connectionAudit.tracks.every(track => track.readyState === 'ended'));
        results.push({ mode, pass: micWasEnabled && pageErrors.length === 0, checks: { micStopsBeforeFinalGrade: true, mediaReleased: true }, pageErrors });
        continue;
      }
      if (mode === 'activity') {
        const waitPoll = async predicate => {
          const expires = Date.now() + 8000;
          while (!predicate(activityPolls.at(-1))) {
            if (Date.now() > expires) throw new Error('Activity poll did not match expected audible state.');
            await page.waitForTimeout(100);
          }
        };
        await waitPoll(value => value?.active === false && value.audio === false);
        const quiet = activityPolls.at(-1);
        await page.mouse.click(5, 5);
        await waitPoll(value => value?.active === true && value.audio === false);
        await page.evaluate(async () => {
          const audit = window.__connectionAudit;
          await audit.sourceContext.resume();
          await audit.connection.playAudio();
          audit.inputGain.gain.value = .2;
        });
        await waitPoll(value => value?.audio === true);
        await page.evaluate(() => window.__connectionAudit.connection.mute(true));
        await waitPoll(value => value?.audio === false);
        await page.evaluate(() => { window.__connectionAudit.outputGain.gain.value = .2; });
        await waitPoll(value => value?.audio === true);
        await page.evaluate(() => window.__connectionAudit.players[0].pause());
        await waitPoll(value => value?.audio === false);
        await page.evaluate(async () => {
          const audit = window.__connectionAudit;
          await audit.connection.playAudio();
          audit.connection.mute(false);
        });
        await waitPoll(value => value?.audio === true);
        automaticFinish = true;
        await page.waitForFunction(() => window.__connectionAudit.tracks.every(track => !track.enabled));
        const drain = await page.evaluate(() => {
          const audit = window.__connectionAudit;
          return audit.players.every(player => !player.paused) && audit.peers.every(peer => peer.signalingState !== 'closed');
        });
        automaticEnded = true;
        await page.waitForFunction(() => window.__connectionAudit.tracks.every(track => track.readyState === 'ended') && window.__connectionAudit.peers.every(peer => peer.signalingState === 'closed'));
        results.push({ mode, pass: drain && pageErrors.length === 0, quiet, checks: { interactionResetsIdle: true, speechCountsAsActivity: true, mutedMicStopsActivity: true, audiblePlaybackCountsAsActivity: true, pausedPlaybackDoesNotCount: true, automaticDrainKeepsReplyAudible: drain, automaticEndReleasesMedia: true }, pageErrors });
        continue;
      }
      if (mode === 'explicit-end' || mode === 'dispose-during-end') {
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
      await page.waitForTimeout(150);
      const early = await page.evaluate(() => {
        const audit = window.__connectionAudit;
        return { tracksSilent: audit.tracks.every(track => !track.enabled || track.readyState === 'ended'), contextsClosed: audit.contexts.every(context => context.state === 'closed'), peerOpen: audit.peers.every(peer => peer.signalingState !== 'closed') };
      });
      const endDuringDrain = endRequests;
      if (mode === 'dispose-during-end') await page.evaluate(() => window.__connectionAudit.connection.dispose());
      await Promise.race([endRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('No /end request.')), 5000))]);
      await page.waitForTimeout(3200); // HTTP /end is still held beyond the resource deadline.
      const pending = await page.evaluate(() => {
        const audit = window.__connectionAudit;
        return { tracksEnded: audit.tracks.every(track => track.readyState === 'ended'), peersClosed: audit.peers.every(peer => peer.signalingState === 'closed'), contextsClosed: audit.contexts.every(context => context.state === 'closed'), fatal: audit.errors.some(error => error.fatal), terminal: audit.snapshots.some(item => item.status === 'ended') };
      });
      releaseEnd();
      const disposed = mode.startsWith('dispose');
      if (!disposed) await page.waitForFunction(() => window.__connectionAudit.snapshots.some(item => item.status === 'ended'), null, { timeout: 10_000 });
      else await page.waitForTimeout(200);
      const settled = await page.evaluate(() => ({ terminal: window.__connectionAudit.snapshots.at(-1)?.status === 'ended', fatal: window.__connectionAudit.errors.some(error => error.fatal) }));
      const checks = {
        microphoneAndPlaybackSilentPromptly: early.tracksSilent && early.contextsClosed,
        healthyPeerDrainsBeforeClose: mode !== 'explicit-end' && mode !== 'dispose-during-end' || early.peerOpen,
        closureRequestStartsPromptly: endDuringDrain === 1,
        localCleanupBeforeHttpEnd: pending.tracksEnded && pending.peersClosed && pending.contextsClosed,
        fatalBeforeHttpEnd: mode !== 'hard-failure' || pending.fatal,
        terminalSnapshotAfterHttpEnd: disposed ? !settled.terminal : settled.terminal,
        fatalAfterHttpEnd: mode !== 'hard-failure' || settled.fatal,
        oneClosureRequest: endRequests === 1,
      };
      results.push({ mode, pass: Object.values(checks).every(Boolean) && !pageErrors.length, checks, early, endDuringDrain, pending, settled, pageErrors });
    } catch (error) {
      const audit = await page.evaluate(() => ({ snapshots: window.__connectionAudit?.snapshots.map(value => value.status), errors: window.__connectionAudit?.errors })).catch(() => null);
      results.push({ mode, pass: false, error: error.message, endRequests, audit, pageErrors });
    } finally {
      releaseEnd?.();
      await page.evaluate(() => {
        const audit = window.__connectionAudit;
        audit.connection?.dispose();
        audit.remotes.forEach(peer => peer.close());
        audit.tracks.forEach(track => track.stop());
        void audit.sourceContext?.close();
      }).catch(() => {});
      await context.close();
    }
  }
} finally { await browser.close(); }

await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ output, results }));
if (results.some(result => !result.pass)) process.exitCode = 1;
