import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const base = process.env.WORKSHOP_URL ?? 'http://127.0.0.1:5173';
const output = new URL(process.env.WORKSHOP_OUTPUT || '../output/workshop/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const paidRequests = [];
const errors = [];
const results = [];
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) paidRequests.push(request.url()); });
page.on('pageerror', error => errors.push(error.message));
const screenshot = async name => page.screenshot({ path: new URL(`${name}.png`, output).pathname, fullPage: true });
const open = async route => { await page.goto(`${base}/storybook/${route}`, { waitUntil: 'networkidle' }); await page.locator('.workshop-heading h2').waitFor(); };
async function check(name, work) {
  try { await work(); results.push({ name, passed: true }); }
  catch (error) { console.error(`${name}: ${error.message}`); results.push({ name, passed: false, error: error.message }); await screenshot(`failure-${name.replaceAll(/[^a-z0-9]/gi, '-')}`); }
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const route of ['draw', 'reel', 'gallery', 'gauge', 'race', 'performance', 'result', 'judging']) {
      await check(`${route} renders at ${viewport.width}`, async () => {
        await open(route);
        assert.equal(await page.locator('.workshop-sidebar nav a.active').count(), 1);
        assert.ok(await page.locator('.workshop-controls').count() >= 1);
        await screenshot(`${route}-${viewport.width}`);
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await check('draw fast landing and stationary footer', async () => {
    await open('draw');
    const footer = await page.locator('.draw-footer').boundingBox();
    await page.getByRole('button', { name: 'Replay draw', exact: true }).click();
    const reSpin = page.getByRole('button', { name: 'Re-spin for a new character', exact: true });
    assert.equal(await page.getByRole('button', { name: 'Spinning…', exact: true }).isDisabled(), true, 'Start must be locked while drawing');
    assert.equal(await reSpin.count(), 0, 'Re-spin should be hidden until landing');
    await page.getByRole('button', { name: 'Start impersonating' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.draw-footer button').disabled);
    const after = await page.locator('.draw-footer').boundingBox();
    assert.ok(Math.abs(after.y - footer.y) < 2, `Footer moved ${after.y - footer.y}px`);
    const window = await page.locator('.character-draw .reel-window').boundingBox();
    const landed = await page.locator('.character-draw .reel-tile[data-landing]').boundingBox();
    assert.ok(Math.abs(landed.y - window.y) < 2, `Landing offset ${landed.y - window.y}px`);
    assert.ok(landed.width > 100, 'Reel has a usable width');
    await screenshot('draw-fast-landed');
    await page.getByLabel('Character', { exact: true }).selectOption('scrum-cop');
    await reSpin.click();
    assert.equal(await page.getByRole('button', { name: 'Spinning…', exact: true }).isDisabled(), true);
    await page.getByRole('heading', { name: 'Scrum Cop', exact: true }).waitFor();
    assert.equal(await reSpin.isEnabled(), true);
    await screenshot('draw-respun');
    await page.getByRole('button', { name: 'Start impersonating' }).click();
    assert.equal(await page.getByRole('button', { name: 'Connecting audio…' }).isDisabled(), true);
    assert.equal(await reSpin.isDisabled(), true);
  });
  await check('draw slow scene does not extend reel animation', async () => {
    await open('draw');
    await page.getByLabel('Scene timing').selectOption('slow');
    await page.getByRole('button', { name: 'Replay draw', exact: true }).click();
    await page.locator('.character-copy').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start impersonating' }).isDisabled(), true);
    await screenshot('draw-slow-landed-pending');
    await page.waitForFunction(() => !document.querySelector('.draw-footer button').disabled);
    await screenshot('draw-slow-ready');
  });
  await check('failed scene recovers through the actual retry control', async () => {
    await open('draw');
    await page.getByLabel('Scene timing').selectOption('failed');
    await page.getByRole('button', { name: 'Replay draw', exact: true }).click();
    await page.getByRole('button', { name: 'Retry scene', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start impersonating' }).isDisabled(), true);
    await screenshot('draw-failed');
    await page.getByRole('button', { name: 'Retry scene', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Start impersonating' }).isEnabled(), true);
  });
  await check('standalone reel lands with chosen character and visible lever', async () => {
    await open('reel');
    await page.getByLabel('Character', { exact: true }).selectOption('scrum-cop');
    await page.getByRole('button', { name: 'Replay spin', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Landed on The Scrum Cop' }).waitFor();
    const reel = await page.locator('.workshop-reel .reel').boundingBox();
    const lever = await page.locator('.workshop-reel .lever').boundingBox();
    assert.ok(reel.width >= 170, `Reel width is ${reel.width}`);
    assert.ok(Math.abs(reel.y - lever.y) < 150, 'Lever should sit beside the reel');
    await screenshot('reel-excel-landed');
  });
  await check('gallery includes the full cast, search, focus preview, and pin', async () => {
    await open('gallery');
    assert.equal(await page.locator('.workshop-character').count(), 42);
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.workshop-character img')];
      return images.length === 42 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    const images = await page.locator('.workshop-character img').evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
      return images.map(image => ({ path: new URL(image.src).pathname, width: image.naturalWidth, height: image.naturalHeight }));
    });
    assert.equal(new Set(images.map(image => image.path)).size, 42, 'Every character needs its own artwork');
    for (const image of images) {
      assert.match(image.path, /^\/characters\/[a-z0-9-]+\.png$/);
      const bytes = await readFile(new URL(`../public${image.path}`, import.meta.url));
      assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Invalid PNG: ${image.path}`);
      assert.equal(bytes.readUInt32BE(16), image.width, `Decoded width differs: ${image.path}`);
      assert.equal(bytes.readUInt32BE(20), image.height, `Decoded height differs: ${image.path}`);
    }
    assert.equal(await page.locator('.workshop-character .missing-art').count(), 0);
    assert.equal(await page.locator('.workshop-controls select').count(), 0, 'The cast is a flat list without a category selector');
    assert.equal(await page.getByRole('heading', { name: 'Judge-facing description', exact: true }).count(), 1);
    results.push({ name: 'all cast artwork loaded, decoded, and present on disk', total: 42, images });
    await page.getByLabel('Search the cast').fill('scrum');
    await page.waitForFunction(() => document.querySelectorAll('.workshop-character').length < 42);
    assert.ok(await page.locator('.workshop-character').count() < 42);
    const scrum = page.getByRole('button', { name: /Scrum Cop/ });
    await scrum.focus();
    assert.match(await page.locator('.workshop-character-detail h2').innerText(), /Scrum Cop/);
    await page.keyboard.press('Enter');
    assert.equal(await scrum.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.workshop-judge-description').innerText(), /ceremonies/);
    await page.getByLabel('Search the cast').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.workshop-character').length === 42);
    assert.equal(await page.locator('.workshop-character').count(), 42);
    await screenshot('gallery-scrum-pinned');
  });
  await check('gauge preserves score and streak during a pause', async () => {
    await open('gauge');
    await page.getByRole('button', { name: '0.799', exact: true }).click();
    assert.match(await page.locator('.workshop-gauge .workshop-note').innerText(), /below the 0.80/);
    await page.getByRole('button', { name: '0.800', exact: true }).click();
    assert.match(await page.locator('.workshop-gauge .workshop-note').innerText(), /qualifies/);
    await page.getByLabel(/^Streak:/).focus();
    await page.keyboard.press('End');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '10');
    await page.getByLabel('Paused speech').check();
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '10');
    assert.match(await page.locator('.gauge-number').textContent(), /80%/);
    await screenshot('gauge-paused');
  });
  await check('race expands all entries and retains a low target', async () => {
    await open('race');
    await page.getByLabel('Readings', { exact: true }).selectOption('low');
    assert.equal(await page.locator('.race-row.target').count(), 1);
    await page.getByRole('button', { name: /Rest of the cast/ }).click();
    assert.equal(await page.locator('.race-row').count(), 42);
    await screenshot('race-expanded');
  });
  await check('performance controls show ten-score win and preserved pause without audio', async () => {
    await open('performance');
    await page.getByLabel(/^Time:/).focus();
    await page.keyboard.press('End');
    for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '10');
    await screenshot('performance-won');
    await page.getByLabel('Timed scenario').selectOption('silence');
    await page.getByLabel(/^Time:/).focus();
    await page.keyboard.press('Home');
    for (let index = 0; index < 6; index++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '3');
    assert.match(await page.locator('.performance-status').innerText(), /fresh speech/);
    assert.ok(await page.locator('.race-row').count() > 1);
    assert.match(await page.locator('.live-indicator').innerText(), /LAST SCORE/);
    await screenshot('performance-silence');
  });
  await check('result controls distinguish surrender and remove rival highlight', async () => {
    await open('result');
    await page.getByLabel('Won', { exact: true }).uncheck();
    assert.equal(await page.getByRole('heading', { name: 'Gave up. Fair enough.' }).count(), 1);
    await page.getByLabel('Rival highlight').uncheck();
    assert.equal(await page.locator('.rival-note').count(), 0);
    await page.getByRole('button', { name: 'Draw again', exact: true }).click();
    assert.match(await page.locator('.workshop-note[role=status]').innerText(), /action received/);
    await screenshot('result-gave-up');
  });
  await check('result preserves final ten scores and transcript through highlight states', async () => {
    await open('result');
    assert.equal(await page.locator('.final-race .race-row').count(), 10);
    assert.match(await page.locator('.final-race .target strong').innerText(), /89/);
    assert.match(await page.locator('.result-stats').innerText(), /96% best match/);
    const original = await page.locator('.review-transcript').textContent();
    assert.ok(await page.locator('.review-transcript mark').count() > 0);
    for (const state of ['none', 'loading', 'error']) {
      await page.getByLabel('Transcript preview').selectOption(state);
      assert.equal(await page.locator('.review-transcript').textContent(), original);
      assert.equal(await page.locator('.review-transcript mark').count(), 0);
      assert.equal(await page.locator('.final-race .race-row').count(), 10);
      await screenshot(`result-${state}`);
    }
    await page.getByRole('button', { name: 'Retry highlights' }).click();
    assert.ok(await page.locator('.review-transcript mark').count() > 0);
    assert.equal(await page.locator('.review-transcript').textContent(), original);
    await page.getByLabel('Transcript preview').selectOption('outside');
    assert.equal(await page.locator('.final-race .race-row').count(), 10);
    assert.equal(await page.locator('.final-race .target').count(), 0);
    await page.getByLabel('Transcript preview').selectOption('empty');
    assert.equal(await page.locator('.final-race .race-row').count(), 0);
    assert.equal(await page.locator('.review-transcript').count(), 0);
    await screenshot('result-empty');
    await page.getByLabel('Transcript preview').selectOption('ready');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Preview width').selectOption('fit');
    assert.equal(await page.locator('.final-race .race-row').count(), 10);
    const geometry = await page.locator('.result-screen').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
    assert.ok(geometry.content <= geometry.width + 1, 'Result content overflows on mobile');
    await screenshot('result-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await check('comparison displays 17 fixtures and 42 readings with distinct semantics', async () => {
    await open('judging');
    assert.equal(await page.getByLabel('Saved transcript').locator('option').count(), 17);
    assert.equal(await page.locator('.workshop-values tbody tr').count(), 42);
    await page.getByLabel('Saved transcript').selectOption('opposite');
    assert.match(await page.locator('.workshop-limitation').innerText(), /0.76/);
    await page.getByLabel('Judgment', { exact: true }).selectOption('score');
    assert.equal(await page.locator('.workshop-values tbody tr').count(), 42);
    assert.match(await page.locator('.workshop-limitation').innerText(), /0.89/);
    assert.equal(await page.getByRole('columnheader', { name: 'Score / 4' }).count(), 1);
    await screenshot('judging-score-limitation');
  });
  await check('width selection changes the live DOM preview geometry', async () => {
    await open('draw');
    await page.getByLabel('Preview width').selectOption('1440');
    assert.equal(Math.round((await page.locator('.workshop-preview').boundingBox()).width), 1440);
    await screenshot('draw-1440-preview-width');
  });
  assert.deepEqual(paidRequests, [], 'Workshop must not call paid API routes');
  assert.deepEqual(errors, [], 'Workshop must not throw browser errors');
} finally {
  await writeFile(new URL('results.json', output), JSON.stringify({ base, recordedAt: new Date().toISOString(), results, paidRequests, errors }, null, 2) + '\n');
  await browser.close();
}
const failures = results.filter(result => result.passed === false);
console.log(JSON.stringify({ checks: results.filter(result => 'passed' in result).length, failures, paidRequests, errors, output: output.pathname }, null, 2));
if (failures.length) process.exitCode = 1;
