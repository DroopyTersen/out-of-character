import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-briefing-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];

function check(value, message) { if (!value) throw new Error(message); }

for (const width of [1440, 390, 320]) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 820 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__micCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
      window.__micCalls++;
      return Promise.reject(new Error('Briefing must not request a microphone'));
    };
  });
  const page = await context.newPage();
  const apiCalls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort(); });
  try {
    const response = await page.goto(`${baseUrl}/storybook/simulator-briefing`, { waitUntil: 'networkidle' });
    check(response?.status() === 200, `HTTP ${response?.status()}`);
    const scenarios = page.getByLabel('Scenario');
    const clients = page.getByLabel('Client');
    check(await scenarios.locator('option').count() === 9, 'all nine scenario options are required');
    const ids = await scenarios.locator('option').evaluateAll(options => options.map(option => option.value));
    for (const id of ids) {
      await scenarios.selectOption(id);
      await page.waitForFunction(expected => document.querySelector('.sim-briefing audio')?.getAttribute('src') === expected, `/simulator/briefings/${id}.mp3`);
      const source = await page.locator('.sim-briefing audio').getAttribute('src');
      check(source === `/simulator/briefings/${id}.mp3`, `wrong clip for ${id}: ${source}`);
      await page.waitForFunction(() => {
        const audio = document.querySelector('.sim-briefing audio');
        return audio && Number.isFinite(audio.duration) && audio.duration > 10;
      });
      check(await page.getByText('Read transcript', { exact: true }).count() === 0, 'transcript control should be absent');
    }
    await clients.selectOption({ index: 1 });
    check((await page.locator('.sim-briefing-heading h1').innerText()).includes(await clients.locator('option').nth(1).innerText()), 'client context did not update');
    await page.getByRole('button', { name: 'Screen only', exact: true }).click();
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    check(overflow.document <= overflow.viewport + 1, `horizontal overflow: ${JSON.stringify(overflow)}`);
    if (width < 700) {
      const button = await page.getByRole('button', { name: 'Start meeting' }).evaluate(node => ({ button: node.getBoundingClientRect().width, parent: node.parentElement.clientWidth - parseFloat(getComputedStyle(node.parentElement).paddingLeft) - parseFloat(getComputedStyle(node.parentElement).paddingRight) }));
      check(Math.abs(button.button - button.parent) <= 2, `mobile start button is not full width: ${JSON.stringify(button)}`);
    }
    await page.screenshot({ path: `${output}/briefing-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Start meeting' }).click();
    check(apiCalls.length === 0, `workshop opened API: ${apiCalls.join(', ')}`);
    check(await page.evaluate(() => window.__micCalls) === 0, 'workshop requested microphone');
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    results.push({ width, pass: true, scenarios: ids.length, overflow, apiCalls: 0, micCalls: 0 });
  } catch (error) {
    await page.screenshot({ path: `${output}/briefing-${width}-failure.png`, fullPage: true }).catch(() => {});
    results.push({ width, pass: false, error: error.stack, apiCalls, errors });
  } finally { await context.close(); }
}

const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await fallback.newPage();
await page.route('**/simulator/briefings/*.mp3', route => route.abort());
try {
  await page.goto(`${baseUrl}/storybook/simulator-briefing`, { waitUntil: 'networkidle' });
  await page.locator('.sim-briefing audio').evaluate(node => node.dispatchEvent(new Event('error')));
  await page.getByText('The intro couldn’t load. Try refreshing the page.').waitFor();
  check(await page.getByRole('button', { name: 'Play intro' }).count() === 0, 'unavailable audio left a broken play control');
  check(await page.getByRole('button', { name: 'Start meeting' }).isEnabled(), 'audio failure blocked starting');
  results.push({ fallback: true, pass: true });
} catch (error) { results.push({ fallback: true, pass: false, error: error.stack }); }
await fallback.close();

const production = await browser.newContext({ viewport: { width: 390, height: 844 } });
await production.addInitScript(() => {
  window.__micCalls = 0;
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
    window.__micCalls++;
    const audio = new AudioContext();
    return Promise.resolve(audio.createMediaStreamDestination().stream);
  };
});
const livePage = await production.newPage();
const apiCalls = [];
let createdPractice;
await livePage.route('**/api/**', route => {
  apiCalls.push(new URL(route.request().url()).pathname);
  const creation = new URL(route.request().url()).pathname === '/api/simulator/sessions';
  if (creation) { const { scenarioId, clientId } = route.request().postDataJSON(); createdPractice = { scenarioId, clientId }; }
  return route.fulfill({ status: creation ? 502 : 200, contentType: 'application/json', body: JSON.stringify(creation ? { error: 'Voice service unavailable.' } : { ended: true }) });
});
try {
  await livePage.goto(`${baseUrl}/simulator`, { waitUntil: 'networkidle' });
  await livePage.getByRole('button', { name: 'Start simulation' }).click();
  await livePage.getByRole('heading', { name: /Before you meet/ }).waitFor();
  check(await livePage.getByRole('button', { name: 'Start meeting' }).evaluate(node => node.getBoundingClientRect().bottom <= innerHeight + 1), 'mobile start button is below the viewport');
  await livePage.waitForFunction(() => Number.isFinite(document.querySelector('.sim-briefing audio')?.duration) && document.querySelector('.sim-briefing audio').duration > 10);
  await livePage.waitForFunction(() => document.querySelector('.sim-briefing audio').currentTime > 0.2);
  await livePage.getByRole('button', { name: 'Pause intro', exact: true }).click();
  const pausedAt = await livePage.locator('.sim-briefing audio').evaluate(node => node.currentTime);
  check(await livePage.locator('.sim-briefing audio').evaluate(node => node.paused), 'pause button did not pause the clip');
  await livePage.waitForTimeout(300);
  check(await livePage.locator('.sim-briefing audio').evaluate((node, pausedAt) => Math.abs(node.currentTime - pausedAt) < 0.1, pausedAt), 'paused playback kept advancing');
  await livePage.getByRole('button', { name: 'Play intro', exact: true }).click();
  await livePage.waitForFunction(pausedAt => document.querySelector('.sim-briefing audio').currentTime > pausedAt + 0.2, pausedAt);
  check(await livePage.locator('.sim-briefing audio').evaluate(node => !node.paused), 'play did not continue playback');
  check(await livePage.getByLabel('Intro recording').isVisible(), 'native audio controls are hidden');
  check(await livePage.getByLabel('Intro recording').evaluate(node => node.controls), 'native audio controls are disabled');
  // Exercise the browser's own keyboard control, then confirm the large button follows it.
  await livePage.getByLabel('Intro recording').press('Space');
  await livePage.getByRole('button', { name: 'Play intro', exact: true }).waitFor();
  await livePage.getByLabel('Intro recording').evaluate(node => { node.currentTime = 5; });
  await livePage.waitForFunction(() => Math.abs(document.querySelector('.sim-briefing audio').currentTime - 5) < 0.2);
  await livePage.getByLabel('Intro recording').press('Space');
  await livePage.getByRole('button', { name: 'Pause intro', exact: true }).waitFor();
  await livePage.screenshot({ path: `${output}/audio-success-390.png`, fullPage: true });
  await livePage.setViewportSize({ width: 1440, height: 900 });
  await livePage.screenshot({ path: `${output}/audio-success-1440.png`, fullPage: true });
  await livePage.evaluate(() => {
    const player = document.querySelector('.sim-briefing audio');
    player.pause();
    document.querySelector('.sim-briefing-play').click();
    player.pause();
  });
  await livePage.waitForTimeout(100);
  check(await livePage.locator('.sim-briefing-error').count() === 0, 'rapid play then pause incorrectly marked the clip unavailable');
  // Let actual playback finish to verify completion, rather than dispatching an ended event.
  await livePage.locator('.sim-briefing audio').evaluate(node => node.play());
  await livePage.waitForFunction(() => document.querySelector('.sim-briefing audio')?.ended, null, { timeout: 60_000 });
  await livePage.getByRole('button', { name: 'Play intro', exact: true }).waitFor();
  check((await livePage.getByRole('button', { name: 'Start meeting' }).getAttribute('class')).includes('primary'), 'completed intro did not emphasize the meeting');
  await livePage.getByRole('button', { name: 'Play intro', exact: true }).click();
  await livePage.waitForFunction(() => { const audio = document.querySelector('.sim-briefing audio'); return !audio.paused && audio.currentTime < 2; });
  check(apiCalls.length === 0, `finishing briefing called API: ${apiCalls.join(', ')}`);
  check(await livePage.evaluate(() => window.__micCalls) === 0, 'finishing briefing requested microphone');
  check(await livePage.getByRole('button', { name: 'Start meeting' }).isEnabled(), 'finished briefing hid start control');
  await livePage.getByRole('button', { name: 'Change scenario or client' }).click();
  await livePage.getByRole('heading', { name: 'Choose your simulation' }).waitFor();
  check(apiCalls.length === 0, 'back from briefing called API');
  check(await livePage.evaluate(() => window.__micCalls) === 0, 'back from briefing requested microphone');
  await livePage.goto(`${baseUrl}/simulator?scenario=deployment&client=quinn`, { waitUntil: 'networkidle' });
  await livePage.getByRole('heading', { name: 'Before you meet Quinn', exact: true }).waitFor();
  check(apiCalls.length === 0 && await livePage.evaluate(() => window.__micCalls) === 0, 'shared intro started a call automatically');
  await livePage.getByRole('button', { name: 'Start meeting' }).click();
  await livePage.getByRole('alert').waitFor();
  const micCalls = await livePage.evaluate(() => window.__micCalls);
  const creations = apiCalls.filter(path => path === '/api/simulator/sessions').length;
  check(micCalls === 1, `explicit start requested microphone ${micCalls} times`);
  check(creations === 1, `explicit start created ${creations} sessions`);
  check(createdPractice?.scenarioId === 'deployment' && createdPractice?.clientId === 'quinn', 'explicit start did not use the shared pair');
  results.push({ productionGate: true, pass: true, baseUrl, prematureApiCalls: 0, prematureMicCalls: 0, micCallsAfterStart: micCalls, sessionCreationAttempts: creations, createdPractice });
} catch (error) { results.push({ productionGate: true, pass: false, error: error.stack, apiCalls }); }
await production.close();

await browser.close();
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
if (results.some(result => !result.pass)) throw new Error(`Briefing acceptance failed: ${output}/results.json`);
console.log(`Briefing acceptance passed: ${output}/results.json`);
