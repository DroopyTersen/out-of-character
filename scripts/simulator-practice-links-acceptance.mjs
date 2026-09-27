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

async function run(name, width, exercise, expectedMicCalls = 0) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: 'reduce' });
  let micCalls = 0;
  const apiCalls = [], errors = [];
  // Real rendering, routing, audio and address-bar URLs; block paid/microphone boundaries only.
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
    assert.equal(micCalls, expectedMicCalls);
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

for (const width of [1440, 390, 320]) {
  await run('direct-and-address-bar', width, async page => {
    await page.goto(`${baseUrl}/simulator?scenario=scope&client=morgan`, { waitUntil: 'networkidle' });
    await expectBriefing(page, 'Morgan', 'scope', 'The small change');
    await page.waitForFunction(() => Number.isFinite(document.querySelector('.sim-briefing audio')?.duration));
    // A shared URL has no prior user gesture. Blocked autoplay must leave usable controls.
    assert.equal(await page.locator('.sim-briefing audio').evaluate(audio => audio.paused), true);
    assert.equal(await page.getByText('Read transcript', { exact: true }).count(), 0);
    if (width === 390) assert.equal(await page.getByRole('button', { name: 'Start meeting' }).evaluate(button => button.getBoundingClientRect().bottom <= innerHeight), true);
    await page.screenshot({ path: `${output}/direct-${width}.png`, fullPage: true });
    assert.equal(page.url(), `${baseUrl}/simulator?scenario=scope&client=morgan`);
    assert.equal(await page.getByRole('button', { name: 'Copy link', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Play intro', exact: true }).isVisible(), true);
    await page.reload({ waitUntil: 'networkidle' });
    await expectBriefing(page, 'Morgan', 'scope', 'The small change');
    await page.getByRole('button', { name: 'Play intro', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sim-briefing audio')?.currentTime > 0.2);
    await page.getByRole('button', { name: 'Change scenario or client' }).click();
    await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
    await page.waitForURL(`${baseUrl}/simulator`);
    await page.getByRole('button', { name: 'Consultancy Done, but not deployed', exact: true }).click();
    await page.getByRole('button', { name: /^Quinn / }).click();
    await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
    await expectBriefing(page, 'Quinn', 'deployment', 'Done, but not deployed');
    await page.waitForURL(`${baseUrl}/simulator?scenario=deployment&client=quinn`);
    await page.waitForFunction(() => {
      const audio = document.querySelector('.sim-briefing audio');
      return audio && !audio.paused && audio.currentTime > 0.2;
    });
    const addressBar = page.url();
    assert.equal(addressBar, `${baseUrl}/simulator?scenario=deployment&client=quinn`);
    await page.goto(addressBar, { waitUntil: 'networkidle' });
    await expectBriefing(page, 'Quinn', 'deployment', 'Done, but not deployed');
  });
}

for (const audioLoad of ['loaded', 'playing', 'failed']) await run(`${audioLoad}-before-hydration`, 390, async page => {
  let releaseScripts;
  const scriptsReady = new Promise(resolve => { releaseScripts = resolve; });
  await page.route('**/*', async route => {
    if (audioLoad === 'failed' && new URL(route.request().url()).pathname.endsWith('.mp3')) return route.abort();
    if (route.request().resourceType() === 'script') await scriptsReady;
    await route.fallback();
  });
  try {
    await page.goto(`${baseUrl}/simulator?scenario=scope&client=morgan`, { waitUntil: 'commit' });
    // Real SSR markup/media load first, as on a cached shared link or slow JS connection.
    await page.waitForFunction(load => {
      const audio = document.querySelector('.sim-briefing audio');
      return load === 'failed' ? audio?.error : Number.isFinite(audio?.duration);
    }, audioLoad);
    if (audioLoad === 'playing') {
      await page.getByLabel('Intro recording').press('Space');
      await page.waitForFunction(() => document.querySelector('.sim-briefing audio').currentTime > 0.2);
    }
  } finally { releaseScripts(); }
  await page.waitForLoadState('networkidle');
  await expectBriefing(page, 'Morgan', 'scope', 'The small change');
  if (audioLoad === 'failed') {
    await page.getByText('The intro couldn’t load. Try refreshing the page.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Play intro' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Start meeting' }).isEnabled(), true);
    return;
  }
  assert.equal(await page.getByLabel('Intro recording').isVisible(), true);
  assert.equal(await page.getByLabel('Intro recording').evaluate(audio => audio.controls && audio.duration > 0), true);
  if (audioLoad === 'playing') {
    await page.getByRole('button', { name: 'Pause intro', exact: true }).click();
    assert.equal(await page.getByLabel('Intro recording').evaluate(audio => audio.paused), true);
  }
  await page.getByRole('button', { name: 'Play intro', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.sim-briefing audio').currentTime > 0.2);
});

await run('selection-and-workshop', 390, async page => {
  for (const query of ['scenario=scope', 'scenario=scope&client=unknown']) {
    await page.goto(`${baseUrl}/simulator?${query}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
    assert.match(await page.getByRole('alert').innerText(), /practice link is incomplete or unavailable/);
    assert.equal(await page.locator('.sim-briefing').count(), 0);
    await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
    await page.waitForURL(`${baseUrl}/simulator?scenario=sharepoint&client=morgan`);
    await page.getByRole('button', { name: 'Change scenario or client' }).click();
    await page.waitForURL(`${baseUrl}/simulator`);
    assert.equal(await page.getByRole('alert').count(), 0);
  }
  await page.goto(`${baseUrl}/simulator`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
  await page.waitForURL(`${baseUrl}/simulator?scenario=sharepoint&client=morgan`);
  await page.waitForFunction(() => {
    const audio = document.querySelector('.sim-briefing audio');
    return audio && !audio.paused && audio.currentTime > 0.2;
  });
  const addressBar = page.url();
  assert.equal(addressBar, `${baseUrl}/simulator?scenario=sharepoint&client=morgan`);
  await page.goto(addressBar, { waitUntil: 'networkidle' });
  await expectBriefing(page, 'Morgan', 'sharepoint', 'The adjacent opportunity');
  await page.goto(`${baseUrl}/storybook/simulator-briefing`, { waitUntil: 'networkidle' });
  await page.getByLabel('Scenario').selectOption('happy-hour');
  await page.getByLabel('Client').selectOption('avery');
  await expectBriefing(page, 'Avery', 'happy-hour', 'The happy hour');
  assert.equal(await page.getByRole('button', { name: 'Copy link', exact: true }).count(), 0);
  await page.getByLabel('Live practice available').uncheck();
  assert.equal(await page.getByRole('button', { name: 'Start meeting' }).isDisabled(), true);
  await page.getByText('Live practice is currently unavailable.', { exact: false }).waitFor();
});

await run('failed-start-clears-link', 390, async page => {
  await page.goto(`${baseUrl}/simulator?scenario=deployment&client=quinn`, { waitUntil: 'networkidle' });
  // The existing microphone denial keeps this on the real pre-live failure path without a paid session.
  await page.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
  await page.getByRole('alert').waitFor();
  await page.waitForURL(`${baseUrl}/simulator`);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
  assert.equal(await page.locator('.sim-briefing').count(), 0);
}, 1);

await browser.close();
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.pass), `Practice link acceptance failed: ${output}/results.json`);
console.log(`Practice link acceptance passed: ${output}/results.json`);
