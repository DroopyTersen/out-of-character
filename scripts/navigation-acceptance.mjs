import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/navigation-acceptance';
const pages = [
  { path: '/', label: 'Game' },
  { path: '/simulator', label: 'Simulator' },
  { path: '/interview', label: 'The Debrief' },
  { path: '/storybook', label: 'Workshop' },
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const report = [];

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => {
      window.__navigationMicCalls = 0;
      if (navigator.mediaDevices?.getUserMedia) navigator.mediaDevices.getUserMedia = () => {
        window.__navigationMicCalls++;
        return Promise.reject(new Error('Navigation check blocks microphone use'));
      };
    });
    const page = await context.newPage();
    const errors = [];
    const paid = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { paid.push(route.request().url()); return route.abort(); });

    for (let index = 0; index < pages.length; index++) {
      const item = pages[index];
      if (index === 0) await page.goto(new URL(item.path, base).toString(), { waitUntil: 'domcontentloaded' });
      else if (width === 1440) {
        await page.locator('.site-desktop-nav').getByRole('link', { name: item.label }).click();
        await page.waitForURL(new URL(item.path, base).toString());
      }
      else await page.goto(new URL(item.path, base).toString(), { waitUntil: 'domcontentloaded' });
      await page.locator('.site-header').waitFor();
      await page.waitForTimeout(300);
      assert.equal(new URL(page.url()).pathname, item.path);
      const nav = width === 1440 ? page.locator('.site-desktop-nav') : page.locator('.site-menu-dialog');
      const trigger = page.getByRole('button', { name: 'Open navigation' });
      if (item.path === '/') assert.equal(await page.locator('.site-header-actions .settings-button').isVisible(), true, 'Game audio action stays in the header');
      if (width === 1440) {
        assert.equal(await nav.getByRole('link').count(), 4);
        assert.equal(await nav.locator('[aria-current="page"]').textContent(), item.label);
        assert.equal(await trigger.isVisible(), false);
      } else {
        assert.equal(await trigger.isVisible(), true);
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${item.path} overflows at ${width}px`);
      await page.screenshot({ path: `${output}/${item.label.toLowerCase().replaceAll(' ', '-')}-${width}.png`, fullPage: true });

      if (width !== 1440) {
        await trigger.click();
        assert.equal(await nav.evaluate(dialog => dialog.open), true);
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        assert.equal(await nav.getByRole('link').count(), 4);
        assert.equal(await nav.locator('[aria-current="page"]').textContent(), item.label);
        assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog') !== null), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog') !== null), true, 'Tab remains inside the open drawer');
        await page.screenshot({ path: `${output}/${item.label.toLowerCase().replaceAll(' ', '-')}-${width}-open.png`, fullPage: true });
        await nav.getByRole('button', { name: 'Close navigation' }).click();
        assert.equal(await nav.evaluate(dialog => dialog.open), false);
        assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
        await trigger.click();
        await page.keyboard.press('Escape');
        assert.equal(await nav.evaluate(dialog => dialog.open), false);
        assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
      }
      report.push({ path: item.path, width, overflow: false, active: item.label });
    }
    if (width !== 1440) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.mouse.click(5, 120);
      assert.equal(await page.locator('.site-menu-dialog').evaluate(dialog => dialog.open), false, 'Backdrop closes drawer');
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.locator('.site-menu-dialog').getByRole('link', { name: 'The Debrief' }).click();
      await page.waitForURL('**/interview');
      assert.equal(new URL(page.url()).pathname, '/interview');
      assert.equal(await page.locator('.site-menu-dialog').evaluate(dialog => dialog.open), false);
    }
    await page.goto(new URL('/storybook/interview-live', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Screen only' }).click();
    await page.getByRole('button', { name: 'Back to workshop controls' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Back to workshop controls' }).click();
    await page.getByRole('button', { name: 'Screen only' }).waitFor({ state: 'visible' });
    await page.goto(new URL('/simulator/voice-lab', base).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.site-header-actions').count(), 0, 'Voice Lab has no duplicate Simulator back link');
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    assert.deepEqual(paid, [], `Unexpected API requests at ${width}px`);
    assert.equal(await page.evaluate(() => window.__navigationMicCalls), 0, `Microphone use at ${width}px`);
    await context.close();
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, checks: report }, null, 2) + '\n');
  console.log(`Navigation acceptance passed: ${report.length} page/viewport checks, drawer interactions, no paid or microphone requests.`);
} finally {
  await browser.close();
}
