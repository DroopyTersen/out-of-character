const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-feedback-acceptance';
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];

function check(value, message) { if (!value) throw new Error(message); }

async function runCase(name, viewport, run) {
  if (process.env.ACCEPTANCE_CASE && !name.startsWith(process.env.ACCEPTANCE_CASE)) return;
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__micCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
      window.__micCalls++;
      return Promise.reject(new Error('Workshop must not request microphone'));
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const apiCalls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => { apiCalls.push(route.request().url()); return route.abort(); });
  let observations = {};
  try {
    observations = await run(page);
    check(!observations.failures?.length, observations.failures?.join('; '));
    check(apiCalls.length === 0, `provider API requests: ${apiCalls.join(', ')}`);
    check(await page.evaluate(() => window.__micCalls) === 0, 'microphone requested');
    check(errors.length === 0, `JS errors: ${errors.join(' | ')}`);
    results.push({ name, viewport, pass: true, observations });
  } catch (error) {
    await page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
    results.push({ name, viewport, pass: false, error: error.message, observations, apiCalls, micCalls: await page.evaluate(() => window.__micCalls).catch(() => null), errors });
  } finally {
    await context.close();
  }
}

for (const width of [390, 1024]) {
  await runCase(`transcript-${width}`, { width, height: 844 }, async page => {
    const response = await page.goto(`${baseUrl}/storybook/simulator-live`, { waitUntil: 'networkidle' });
    check(response?.status() === 200, `live route HTTP ${response?.status()}`);
    const next = page.locator('.workshop-controls').getByRole('button', { name: 'Next turn' });
    for (let turn = 0; turn < 9; turn++) await next.click();
    await page.getByRole('button', { name: 'Screen only' }).click();
    const toggle = page.getByRole('button', { name: 'Transcript', exact: true });
    await toggle.focus();
    await toggle.click();
    const panel = page.locator('.sim-transcript-panel');
    check(await panel.locator('article').count() === 9, 'turn 9 transcript did not open');
    await page.waitForTimeout(500);
    const opened = await panel.evaluate(node => {
      const box = node.getBoundingClientRect();
      return {
        inViewport: box.top < innerHeight - 32 && box.bottom > 0,
        focusWithin: node.contains(document.activeElement),
        top: Math.round(box.top),
        viewportHeight: innerHeight,
      };
    });
    await page.screenshot({ path: `${output}/transcript-${width}-open.png`, fullPage: true });
    await page.getByRole('button', { name: 'Close transcript' }).click();
    const closed = {
      hidden: await panel.count() === 0,
      focusReturned: await toggle.evaluate(node => document.activeElement === node),
    };
    const observations = { opened, closed };
    observations.failures = [
      !opened.inViewport && `opened conversation remains below viewport (top ${opened.top}, viewport ${opened.viewportHeight})`,
      !opened.focusWithin && 'opening transcript did not move keyboard focus into conversation panel',
      !closed.hidden && 'closing transcript did not hide panel',
      !closed.focusReturned && 'closing transcript did not return focus to Transcript',
    ].filter(Boolean);
    return observations;
  });
}

await runCase('overpromise-debrief', { width: 1024, height: 844 }, async page => {
  const response = await page.goto(`${baseUrl}/storybook/simulator-debrief`, { waitUntil: 'networkidle' });
  check(response?.status() === 200, `debrief route HTTP ${response?.status()}`);
  const earnedKeep = await page.locator('.sim-takeaways article').filter({ has: page.locator('.eyebrow', { hasText: /^KEEP/ }) }).count();
  await page.getByLabel('Attempt').selectOption('scope-overpromise');
  const concern = await page.locator('.sim-notice').allInnerTexts();
  const rapport = await page.locator('.sim-skill').filter({ has: page.locator('summary', { hasText: 'Rapport' }) }).locator('strong').innerText();
  const harmfulKeep = await page.locator('.sim-takeaways article').evaluateAll(articles => articles.some(article =>
    article.querySelector('.eyebrow')?.textContent?.startsWith('KEEP') &&
    /guarantee the complete dashboard/i.test(article.querySelector('blockquote')?.textContent ?? '')
  ));
  await page.screenshot({ path: `${output}/overpromise-debrief.png`, fullPage: true });
  const observations = { earnedKeep, concern, rapport, harmfulKeep, failures: [
    earnedKeep === 0 && 'earned-discovery lost its positive KEEP takeaway',
    !concern.some(text => text.includes('commitment')) && 'overpromise concern is not displayed',
    rapport !== '3.1' && `recorded rapport reading changed or disappeared: ${rapport}`,
    harmfulKeep && 'harmful guarantee is presented as advice to KEEP',
  ].filter(Boolean) };
  return observations;
});

await browser.close();
await writeFile(`${output}/report.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).map(result => ({ name: result.name, error: result.error })) }, null, 2));
if (results.some(result => !result.pass)) process.exitCode = 1;
