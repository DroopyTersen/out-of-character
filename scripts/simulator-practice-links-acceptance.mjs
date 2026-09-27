import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-practice-links-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--autoplay-policy=document-user-activation-required'],
});
const results = [];

async function run(name, width, exercise) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  let micCalls = 0;
  const apiCalls = [], errors = [];
  // Real rendering, routing, audio and clipboard; block paid/microphone boundaries only.
  await context.exposeBinding('__recordMic', () => { micCalls++; });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => { window.__recordMic(); return Promise.reject(new Error('Unexpected microphone request')); };
  });
  await context.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await exercise(page);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(pageWidth <= width + 1, `Horizontal overflow: ${pageWidth} > ${width}`);
    assert.equal(micCalls, 0);
    assert.deepEqual(apiCalls, []);
    assert.deepEqual(errors, []);
    results.push({ name, baseUrl, width, pass: true, pageWidth, micCalls, apiCalls, errors });
  } catch (error) {
    await page.screenshot({ path: `${output}/${name}-${width}-failure.png`, fullPage: true }).catch(() => {});
    results.push({ name, baseUrl, width, pass: false, error: error.stack, micCalls, apiCalls, errors });
  } finally { await context.close(); }
}

async function expectBriefing(page, client, scenario, title) {
  await page.getByRole('heading', { name: `Before you meet ${client}`, exact: true }).waitFor();
  assert.equal(await page.locator('.sim-briefing-context strong').innerText(), title);
  assert.equal(await page.locator('.sim-briefing audio').getAttribute('src'), `/simulator/briefings/${scenario}.mp3`);
}

async function copyLink(page, expectedPath) {
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByRole('button', { name: 'Link copied', exact: true }).waitFor();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(url, new URL(expectedPath, baseUrl).href);
  return url;
}

for (const width of [1440, 390, 320]) {
  await run('direct-and-copy', width, async page => {
    await page.goto(`${baseUrl}/simulator?scenario=scope&client=morgan`, { waitUntil: 'networkidle' });
    await expectBriefing(page, 'Morgan', 'scope', 'The small change');
    await page.waitForFunction(() => Number.isFinite(document.querySelector('.sim-briefing audio')?.duration));
    // A shared URL has no prior user gesture. Blocked autoplay must leave usable controls.
    assert.equal(await page.locator('.sim-briefing audio').evaluate(audio => audio.paused && audio.controls && !audio.hidden), true);
    assert.equal(await page.locator('.sim-briefing-transcript').getAttribute('open'), null);
    if (width === 390) assert.equal(await page.getByRole('button', { name: 'Start conversation' }).evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
    await page.screenshot({ path: `${output}/direct-${width}.png`, fullPage: true });
    await copyLink(page, '/simulator?scenario=scope&client=morgan');
    await page.reload({ waitUntil: 'networkidle' });
    await expectBriefing(page, 'Morgan', 'scope', 'The small change');
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sim-briefing audio')?.currentTime > 0.2);
    await page.getByRole('button', { name: 'Change scenario or client' }).click();
    await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
    await page.getByRole('button', { name: 'Consultancy Done, but not deployed', exact: true }).click();
    await page.getByRole('button', { name: /^Quinn / }).click();
    await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
    await expectBriefing(page, 'Quinn', 'deployment', 'Done, but not deployed');
    const copied = await copyLink(page, '/simulator?scenario=deployment&client=quinn');
    await page.goto(copied, { waitUntil: 'networkidle' });
    await expectBriefing(page, 'Quinn', 'deployment', 'Done, but not deployed');
  });
}

await run('selection-and-workshop', 390, async page => {
  for (const query of ['scenario=scope', 'scenario=scope&client=unknown']) {
    await page.goto(`${baseUrl}/simulator?${query}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
    assert.match(await page.getByRole('alert').innerText(), /practice link is incomplete or unavailable/);
    assert.equal(await page.locator('.sim-briefing').count(), 0);
  }
  await page.goto(`${baseUrl}/simulator`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
  const copied = await copyLink(page, '/simulator?scenario=sharepoint&client=morgan');
  await page.goto(copied, { waitUntil: 'networkidle' });
  await expectBriefing(page, 'Morgan', 'sharepoint', 'The adjacent opportunity');
  await page.goto(`${baseUrl}/storybook/simulator-briefing`, { waitUntil: 'networkidle' });
  await page.getByLabel('Scenario').selectOption('happy-hour');
  await page.getByLabel('Client').selectOption('avery');
  const workshopLink = await copyLink(page, '/simulator?scenario=happy-hour&client=avery');
  await page.getByLabel('Live practice available').uncheck();
  assert.equal(await page.getByRole('button', { name: 'Start conversation' }).isDisabled(), true);
  await page.getByText('Live practice is currently unavailable.', { exact: false }).waitFor();
  await page.goto(workshopLink, { waitUntil: 'networkidle' });
  await expectBriefing(page, 'Avery', 'happy-hour', 'The happy hour');
});

await run('clipboard-fallback', 320, async page => {
  // Simulate the browser denying clipboard permission; keep the rendered fallback real.
  await page.addInitScript(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Clipboard denied', 'NotAllowedError')); });
  await page.goto(`${baseUrl}/simulator?scenario=deployment&client=quinn`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Practice link', exact: true });
  await input.waitFor();
  assert.equal(await input.inputValue(), `${baseUrl}/simulator?scenario=deployment&client=quinn`);
  assert.equal(await input.getAttribute('readonly'), '');
  await input.focus();
  assert.equal(await input.evaluate(node => node.selectionEnd - node.selectionStart === node.value.length), true);
  await page.screenshot({ path: `${output}/clipboard-fallback-320.png`, fullPage: true });
});

await browser.close();
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.pass), `Practice link acceptance failed: ${output}/results.json`);
console.log(`Practice link acceptance passed: ${output}/results.json`);
