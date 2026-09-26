import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Scene transport, draw entropy, and microphone permission are controlled.
// The actual game, selection algorithm, reel, and cancellation remain real.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.ACCEPTANCE_OUTPUT || 'output/selection-acceptance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const requests = [];
    const errors = [];
    let pendingScene;
    let releaseScene;
    let sceneMode = 'ready';
    await page.addInitScript(() => {
      const random = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = values => {
        if (values instanceof Uint32Array && values.length === 1) { values[0] = 0; return values; }
        return random(values);
      };
      // Hold the real connection screen without opening the user's microphone.
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
    await page.route('**/api/scene', async route => {
      const request = route.request().postDataJSON();
      requests.push(request);
      if (sceneMode === 'failed') {
        await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Scene generation failed. Please try again.' }) });
        return;
      }
      if (sceneMode === 'pending') {
        pendingScene = request;
        await new Promise(resolve => { releaseScene = resolve; });
      }
      const scene = `A client has a difficult question for ${request.characterId}. What do you say?`;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attemptId: request.attemptId, requestId: request.requestId, scene }) }).catch(() => {});
    });
    page.on('pageerror', error => errors.push(error.message));
    const reSpin = page.getByRole('button', { name: 'Re-spin for a new character', exact: true });
    const start = page.getByRole('button', { name: 'Start your turn', exact: true });
    const selected = () => page.locator('.reel').getAttribute('aria-label');
    const waitForSelection = () => page.waitForFunction(() => {
      const label = document.querySelector('.reel')?.getAttribute('aria-label') || '';
      const copy = document.querySelector('.character-copy');
      const expected = label.replace(/^Selected: /, '').replace(/^The /, '');
      return label.startsWith('Selected: ') && copy?.querySelector('h2')?.textContent === expected && Number(getComputedStyle(copy).opacity) === 1;
    });

    try {
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      assert.equal(await reSpin.count(), 0, 'Re-spin should appear only after a draw');
      await page.getByRole('button', { name: 'Spin for a character', exact: true }).click();
      await waitForSelection();
      await reSpin.waitFor();
      const first = await selected();
      const firstRequest = requests.at(-1);
      await reSpin.click();
      await waitForSelection();
      assert.notEqual(await selected(), first, 'Re-spin must select a different character even with the same random value');
      assert.notEqual(requests.at(-1).characterId, firstRequest.characterId);
      assert.notEqual(requests.at(-1).attemptId, firstRequest.attemptId);
      assert.notEqual(requests.at(-1).requestId, firstRequest.requestId);
      await page.waitForFunction(() => !document.querySelector('.draw-footer .primary').disabled);
      assert.ok((await page.locator('.scene-copy').innerText()).includes(requests.at(-1).characterId), 'The scene must belong to the new character');
      await page.waitForFunction(() => {
        const scene = document.querySelector('.scene-copy > p');
        return scene && Number(getComputedStyle(scene).opacity) === 1;
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/respin-${viewport.width}.png`, fullPage: true });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(layout.content <= layout.viewport, 'Selection controls must not cause horizontal overflow');

      sceneMode = 'failed';
      await reSpin.click();
      await waitForSelection();
      await page.getByRole('button', { name: 'Retry scene', exact: true }).waitFor();
      assert.equal(await start.isDisabled(), true);
      assert.equal(await reSpin.isEnabled(), true, 'A failed scene must not prevent changing character');

      sceneMode = 'pending';
      await reSpin.click();
      await waitForSelection();
      assert.equal(await start.isDisabled(), true);
      assert.equal(await reSpin.isEnabled(), true, 'A pending scene must not prevent changing character after landing');
      assert.ok(pendingScene, 'The previous scene request should still be pending');
      sceneMode = 'ready';
      await reSpin.click();
      await waitForSelection();
      await page.waitForFunction(() => !document.querySelector('.draw-footer .primary').disabled);
      const replacement = requests.at(-1);
      releaseScene();
      await page.waitForTimeout(200);
      assert.notEqual(replacement.characterId, pendingScene.characterId);
      assert.ok((await page.locator('.scene-copy').innerText()).includes(replacement.characterId), 'A late scene response must not replace the re-spun character scene');

      await start.click();
      await page.getByRole('button', { name: 'Connecting audio…' }).waitFor();
      assert.equal(await reSpin.isDisabled(), true, 'Re-spin must be locked once a turn is starting');
      await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
      await page.getByRole('button', { name: 'Spin for a character', exact: true }).waitFor();
      assert.deepEqual(errors, [], 'Selection should not throw browser errors');
      results.push({ viewport, passed: true, sceneRequests: requests.length });
    } finally {
      releaseScene?.();
      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(`${output}/report.json`, JSON.stringify({ baseUrl, results, fixtureBoundary: 'Scene HTTP responses, deterministic draw entropy, and pending microphone permission; no paid services called.' }, null, 2));
console.log(JSON.stringify({ results, output }, null, 2));
