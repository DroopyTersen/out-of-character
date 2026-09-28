import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5175';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/report-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const mode of ['complete', 'late-failure', 'status-error', 'leave', 'back-restore', 'interrupted', 'missing', 'end-failure', 'ungraded']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ mode }) => {
      const originalFetch = window.fetch;
      const audit = window.__reportTest = { starts: 0, polls: 0, aborts: 0, ended: false, mode };
      // Only substitute paid media/network boundaries. React, LiveConnection,
      // useSessionReport, the AI SDK parser and rendered debrief are real.
      navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
      window.RTCPeerConnection = class extends EventTarget {
        iceGatheringState = 'complete'; connectionState = 'connected';
        addTrack() {} createDataChannel() { return { readyState: 'open' }; }
        async createOffer() { return { type: 'offer', sdp: 'fixture' }; }
        async setLocalDescription(value) { this.localDescription = value; }
        async setRemoteDescription() {} close() { this.connectionState = 'closed'; }
      };
      window.fetch = async (url, options = {}) => {
        if (!String(url).includes('/api/simulator/sessions')) return originalFetch(url, options);
        const action = String(url).split('/').at(-1);
        if (action === 'sessions') {
          const request = JSON.parse(options.body); audit.id = request.id; audit.ended = false;
          await new Promise(resolve => setTimeout(resolve, 40));
          return Response.json({ sdp: 'fixture', snapshot: { ...audit.snapshot, id: audit.id, status: 'connecting' } });
        }
        if (action === 'report') {
          if (mode === 'ungraded') { audit.state = { status: 'ineligible', starts: 0, report: null, failure: null }; return Response.json({ error: 'Ungraded conversation' }, { status: 422 }); }
          audit.starts++;
          audit.state = { status: 'running', starts: audit.starts, report: null, failure: null };
          const stream = new ReadableStream({ start(controller) {
            audit.stream = controller;
            options.signal.addEventListener('abort', () => { audit.aborts++; controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true });
          } });
          return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
        }
        if (action === 'end') { audit.ended = true; if (mode === 'end-failure') throw new TypeError('The End response was lost.'); }
        if (action === 'poll' && mode === 'interrupted') audit.ended = true;
        if (action === 'poll' && audit.ended) {
          audit.polls++;
          if (audit.statusError) return new Response('Unavailable', { status: 503 });
        }
        return Response.json({ ...audit.snapshot, id: audit.id, status: audit.ended ? mode === 'interrupted' ? 'interrupted' : 'ended' : 'live', report: audit.state });
      };
    }, { mode });
    await page.goto(`${base}/simulator?scenario=${mode === 'ungraded' ? 'happy-hour' : 'sharepoint'}&client=morgan`, { waitUntil: 'networkidle' });
    await page.evaluate(async mode => {
      const catalog = await (await fetch('/api/simulator/catalog')).json();
      const { recordedAttempt, simulatorFixtures, happyHourFixture } = await import('/app/storybook/simulator-recordings.ts');
      const fixture = mode === 'ungraded' ? happyHourFixture : simulatorFixtures.find(item => item.id === 'earned-discovery');
      const { snapshot, scenario } = recordedAttempt(catalog, fixture, fixture.transcript.length);
      if (mode === 'missing') snapshot.evaluation = null;
      snapshot.finalization = 'confirmed';
      const skills = Object.fromEntries(['credibility', 'confidence', 'listening', 'rapport', 'clarity', 'guidance', 'adaptability'].map(id => [id, { score: 1.2, evidenceIds: ['p2'] }]));
      window.__reportTest.snapshot = snapshot;
      window.__reportTest.final = { evaluation: { skills, objectives: Object.fromEntries(scenario.objectives.map(({ id }) => [id, { achieved: false, evidenceIds: [] }])) }, overview: 'You found a useful opening. Now make the next step more specific.', strengths: [{ text: 'You asked who owns the problem.', evidenceIds: ['p2'] }], improvements: [], nextPractice: 'Confirm a concrete next step.' };
    }, mode);
    await page.getByRole('button', { name: 'Start meeting', exact: true }).click();
    await page.getByRole('button', { name: 'End session', exact: true }).waitFor();
    if (mode !== 'interrupted') await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.locator('.sim-debrief').waitFor();
    if (mode === 'ungraded') {
      assert.equal(await page.evaluate(() => window.__reportTest.starts), 0);
      assert.equal(await page.locator('.sim-report, .sim-assessment').count(), 0);
    } else {
      await page.waitForFunction(() => window.__reportTest.starts === 1);
      assert.match(await page.locator('.sim-report').innerText(), /Compiling your report/);
      if (mode === 'missing') assert.equal(await page.locator('.sim-skill strong').first().innerText(), '—');
      else assert.equal(await page.locator('.sim-skill strong').first().innerText(), '3.6');
      // Evaluation is deliberately delivered first; it must stay provisional.
      await page.evaluate(() => { const a = window.__reportTest; const text = JSON.stringify(a.final); a.sent = text.indexOf(',"strengths"'); a.stream.enqueue(new TextEncoder().encode(text.slice(0, a.sent))); });
      await page.getByText('You found a useful opening. Now make the next step more specific.', { exact: true }).waitFor();
      assert.equal(await page.locator('.sim-skill strong').first().innerText(), mode === 'missing' ? '—' : '3.6');
      assert.equal(await page.locator('.sim-report-evidence').count(), 0);
      if (mode === 'back-restore') {
        // Exercise the persisted-page lifecycle, including browsers that do not
        // enable a real BFCache during automation/media emulation.
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await page.waitForFunction(() => window.__reportTest.aborts === 1);
        await page.evaluate(() => { const a = window.__reportTest; a.state = { status: 'completed', starts: 1, report: a.final, failure: null }; window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
        await page.getByRole('button', { name: 'Check report', exact: true }).click();
        await page.getByRole('heading', { name: 'Final assessment', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__reportTest.starts), 1);
      } else if (mode === 'leave') {
        await page.getByRole('button', { name: 'Choose another simulation', exact: true }).click();
        await page.waitForFunction(() => window.__reportTest.aborts === 1);
        assert.equal(await page.locator('.sim-report').count(), 0);
      } else {
        await page.evaluate(mode => {
          const a = window.__reportTest;
          a.state = mode === 'late-failure' ? { status: 'failed', starts: 1, report: null, failure: 'provider' } : { status: 'completed', starts: 1, report: a.final, failure: null };
          a.statusError = mode === 'status-error';
          a.stream.enqueue(new TextEncoder().encode(JSON.stringify(a.final).slice(a.sent))); a.stream.close();
        }, mode);
        if (mode === 'late-failure') {
          await page.getByRole('button', { name: 'Retry report', exact: true }).waitFor();
          assert.equal(await page.getByText('You asked who owns the problem.', { exact: true }).count(), 0);
          assert.equal(await page.locator('.sim-skill strong').first().innerText(), '3.6');
          await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
          assert.equal(await page.getByRole('heading', { name: 'Final report unavailable', exact: true }).count(), 1);
          assert.equal(await page.getByRole('button', { name: 'Check report', exact: true }).count(), 0);
          await page.getByRole('button', { name: 'Retry report', exact: true }).dblclick();
          assert.equal(await page.evaluate(() => window.__reportTest.starts), 2);
          await page.evaluate(() => { const a = window.__reportTest; a.state = { status: 'failed', starts: 2, report: null, failure: 'provider' }; a.stream.close(); });
          await page.getByRole('heading', { name: 'Final report unavailable', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Retry report', exact: true }).count(), 0);
        } else {
          if (mode === 'status-error') {
            await page.getByRole('button', { name: 'Check report', exact: true }).waitFor();
            await page.evaluate(() => { window.__reportTest.statusError = false; });
            await page.getByRole('button', { name: 'Check report', exact: true }).click();
          }
          await page.getByRole('heading', { name: 'Final assessment', exact: true }).waitFor();
          assert.equal(await page.locator('.sim-skill strong').first().innerText(), '1.2');
          assert.equal(await page.locator('.sim-objectives .achieved').count(), 0);
          assert.equal(await page.locator('.sim-report-evidence').count(), 1);
          assert.equal(await page.evaluate(() => window.__reportTest.starts), 1);
        }
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    results.push({ mode, passed: true });
    console.log(`${mode}: passed`);
    await context.close();
  }
} finally { await browser.close(); await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); }
