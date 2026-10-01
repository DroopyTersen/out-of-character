import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5174';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/interview-streaming/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];

try {
  for (const mode of ['complete', 'markdown', 'late-failure', 'status-error', 'new-interview', 'leave', 'interrupted', 'end-failure', 'silent']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(({ mode }) => {
        const originalFetch = window.fetch;
        const audit = window.__summaryTest = {
          mode, starts: 0, polls: 0, aborts: 0, ended: false, peerClosed: false, track: null,
          privateCue: 'PRIVATE CUE: never put this in the browser summary',
          expected: 'The participant described an access delay and credited Jen with resolving it.',
        };
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { audit.copied = text; } } });
        if (mode === 'markdown') audit.expected = 'The participant described an access delay.\n\n## At a glance\n\n- **Win:** Jen restored access.\n\n## Client experience\n\nAccess arrived late.\n\n## Internal delivery and process\n\nNot discussed in this interview.\n\n## Delivery and contributions\n\n| Person | Contribution |\n| --- | --- |\n| Jen | Restored access |\n\n```mermaid\nflowchart TD\n  A["Access delay"] --> B["Jen restored access"]\n```\n\n![Tracking image](https://summary-image.invalid/private)\n\n<script>window.__summaryInjected = true</script>';
        navigator.mediaDevices.getUserMedia = async () => {
          const track = (audit.track = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0]);
          return new MediaStream([track]);
        };
        window.RTCPeerConnection = class extends EventTarget {
          iceGatheringState = 'complete'; connectionState = 'connected';
          addTrack() {} createDataChannel() { return { readyState: 'open' }; }
          async createOffer() { return { type: 'offer', sdp: 'fixture' }; }
          async setLocalDescription(value) { this.localDescription = value; }
          async setRemoteDescription() {}
          close() { this.connectionState = 'closed'; audit.peerClosed = true; }
        };
        audit.snapshot = {
          id: '', scenarioId: 'project-closeout', clientId: 'sam-cedar', status: 'connecting',
          startedAt: Date.now(), limitSeconds: 3600, warning: null, revision: 1,
          transcript: mode === 'silent' ? [] : [{ id: 'p1', speaker: 'trainee', text: 'Jen helped us resolve the access delay.', startMs: 100, endMs: 1200 }],
          evaluation: null, coaching: null, feedbackStatus: 'current', message: null,
          finalization: 'confirmed', usageSeconds: 2,
          interview: { evaluation: null, summary: { status: 'pending', text: null } },
        };
        window.fetch = async (url, options = {}) => {
          if (!String(url).includes('/api/simulator/sessions')) return originalFetch(url, options);
          const action = String(url).split('/').at(-1);
          if (action === 'sessions') {
            const request = JSON.parse(options.body);
            audit.id = request.id;
            audit.capability = new Headers(options.headers).get('Authorization');
            audit.ended = false;
            return Response.json({ sdp: 'fixture', snapshot: { ...audit.snapshot, id: audit.id } });
          }
          if (new Headers(options.headers).get('Authorization') !== audit.capability) throw new Error('Session capability changed.');
          if (action === 'report') {
            if (mode === 'silent') {
              audit.state = { status: 'ineligible', starts: 0, report: null, failure: null };
              return Response.json({ error: 'No participant speech.' }, { status: 422 });
            }
            audit.starts++;
            audit.state = { status: 'running', starts: audit.starts, report: null, failure: null };
            const stream = new ReadableStream({ start(controller) {
              audit.stream = controller;
              options.signal.addEventListener('abort', () => {
                audit.aborts++;
                controller.error(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            } });
            return new Response(stream, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
          }
          if (action === 'end') {
            audit.ended = true;
            if (mode === 'end-failure') throw new TypeError('The End response was lost.');
          }
          if (action === 'poll' && mode === 'interrupted') audit.ended = true;
          if (action === 'poll' && audit.ended) {
            audit.polls++;
            if (audit.statusError) return new Response('Unavailable', { status: 503 });
          }
          return Response.json({ ...audit.snapshot, id: audit.id,
            status: audit.ended ? mode === 'interrupted' ? 'interrupted' : 'ended' : 'live',
            report: audit.state,
          });
        };
      }, { mode });
      await page.goto(`${base}/interview`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Start interview', exact: true }).click();
      await page.getByRole('button', { name: 'End interview', exact: true }).waitFor();
      if (mode !== 'interrupted') await page.getByRole('button', { name: 'End interview', exact: true }).click();
      await page.locator('.interview-summary').waitFor();
      if (mode === 'silent') {
        assert.equal(await page.evaluate(() => window.__summaryTest.starts), 0);
        assert.equal(await page.getByRole('button', { name: 'Copy summary', exact: true }).count(), 0);
      } else {
        await page.waitForFunction(() => window.__summaryTest.starts === 1);
        await page.getByRole('heading', { name: 'Putting your conversation together', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Copy summary', exact: true }).count(), 0);
        await page.evaluate(() => {
          const a = window.__summaryTest;
          a.final = { text: a.expected };
          const json = JSON.stringify(a.final);
          a.sent = json.indexOf(a.mode === 'markdown' ? '## At a glance' : 'and credited');
          a.stream.enqueue(new TextEncoder().encode(json.slice(0, a.sent)));
        });
        await page.getByText('The participant described an access delay', { exact: false }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Copy summary', exact: true }).count(), 0);
        if (mode === 'new-interview') {
          await page.getByRole('button', { name: 'New interview', exact: true }).click();
          await page.waitForFunction(() => window.__summaryTest.aborts === 1);
          assert.equal(await page.locator('.interview-summary').count(), 0);
        } else if (mode === 'leave') {
          await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
          await page.waitForFunction(() => window.__summaryTest.aborts === 1);
        } else {
          await page.evaluate(mode => {
            const a = window.__summaryTest;
            a.state = mode === 'late-failure'
              ? { status: 'failed', starts: a.starts, report: null, failure: 'provider' }
              : { status: 'completed', starts: a.starts, report: a.final, failure: null };
            a.statusError = mode === 'status-error';
            a.stream.enqueue(new TextEncoder().encode(JSON.stringify(a.final).slice(a.sent)));
            a.stream.close();
          }, mode);
          if (mode === 'late-failure') {
            await page.getByRole('button', { name: 'Retry summary', exact: true }).waitFor();
            assert.equal(await page.locator('.interview-summary-text').count(), 0);
            await page.getByRole('button', { name: 'Retry summary', exact: true }).dblclick();
            assert.equal(await page.evaluate(() => window.__summaryTest.starts), 2);
            await page.evaluate(() => {
              const a = window.__summaryTest;
              a.state = { status: 'failed', starts: 2, report: null, failure: 'provider' };
              a.stream.close();
            });
            await page.getByRole('heading', { name: 'The summary is unavailable', exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Retry summary', exact: true }).count(), 0);
          } else {
            if (mode === 'status-error') {
              await page.getByRole('button', { name: 'Check summary', exact: true }).waitFor();
              await page.evaluate(() => { window.__summaryTest.statusError = false; });
              await page.getByRole('button', { name: 'Check summary', exact: true }).click();
            }
            await page.getByRole('button', { name: 'Copy summary', exact: true }).waitFor();
            if (mode === 'markdown') {
              for (const name of ['At a glance', 'Client experience', 'Internal delivery and process', 'Delivery and contributions']) {
                await page.getByRole('heading', { name, exact: true }).waitFor();
              }
              assert.equal(await page.locator('.interview-summary-text li').count(), 1);
              assert.equal(await page.locator('.interview-summary-text table tbody tr').count(), 1);
              const diagram = page.locator('.interview-summary-text [data-streamdown="mermaid-block"]');
              await diagram.scrollIntoViewIfNeeded();
              await diagram.locator('svg[role="graphics-document document"]').waitFor();
              assert.ok((await diagram.innerText()).includes('Jen restored access'));
              assert.equal(await page.locator('.interview-summary-text img, .interview-summary-text script').count(), 0);
              assert.equal(await page.evaluate(() => Boolean(window.__summaryInjected)), false);
            } else {
              assert.equal(await page.locator('.interview-summary-text').innerText(), await page.evaluate(() => window.__summaryTest.expected));
            }
            await page.getByRole('button', { name: 'Copy summary', exact: true }).click();
            assert.equal(await page.evaluate(() => window.__summaryTest.copied), await page.evaluate(() => window.__summaryTest.expected));
            assert.equal(await page.evaluate(() => window.__summaryTest.starts), 1);
          }
        }
      }
      assert.equal(await page.evaluate(() => window.__summaryTest.track?.readyState), 'ended');
      assert.equal(await page.evaluate(() => window.__summaryTest.peerClosed), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal((await page.locator('body').innerText()).includes('PRIVATE CUE'), false);
      assert.deepEqual(errors, []);
      results.push({ mode, passed: true });
      console.log(`${mode}: passed`);
    } catch (error) {
      results.push({ mode, passed: false, error: error.message, errors });
      console.error(`${mode}: ${error.message}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
