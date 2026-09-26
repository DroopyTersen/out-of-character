import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-design';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const viewport of (process.env.DESIGN_SCREEN === '1' ? [{ width: 1672, height: 941 }, { width: 1024, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 800 }] : [{ width: 1672, height: 941 }, { width: 390, height: 844 }])) {
    for (const [story, selector] of [['selection', '.sim-selection'], ['live', '.sim-conversation'], ['debrief', '.sim-debrief'], ['judging', '.sim-lab']]) {
      if (process.env.DESIGN_STORY && process.env.DESIGN_STORY !== story) continue;
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], api = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { api.push(route.request().url()); return route.abort(); });
      await page.goto(`${base}/storybook/simulator-${story}`, { waitUntil: 'networkidle' });
      if (story === 'selection') await page.getByLabel('Larger collection (illustrative)').check();
      if (story === 'live') for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Next turn' }).click();
      if (story === 'judging') await page.getByRole('button', { name: 'Show full result' }).click();
      if (process.env.DESIGN_SCREEN === '1') {
        await page.getByRole('button', { name: 'Screen only', exact: true }).click();
        await page.locator('.workshop-shell.screen-only').waitFor();
      }
      await page.evaluate(() => document.fonts.ready);
      const screen = page.locator(selector);
      await screen.scrollIntoViewIfNeeded();
      await screen.screenshot({ path: `${output}/${story}-${viewport.width}.png` });
      if (process.env.DESIGN_SCREEN === '1') {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${output}/${story}-${viewport.width}-screen.png`, fullPage: true });
        await page.screenshot({ path: `${output}/${story}-${viewport.width}-viewport.png` });
      }
      if (story === 'judging') {
        await page.getByText('Inspect raw typed judgments and distributions').click();
        await page.locator('.sim-raw-judgments').screenshot({ path: `${output}/raw-${viewport.width}.png` });
      }
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (dimensions.document > dimensions.viewport + 1) errors.push(`Overflow: ${dimensions.document} > ${dimensions.viewport}`);
      if (process.env.DESIGN_SCREEN === '1' && !await page.locator('.workshop-shell.screen-only').count()) errors.push('Screen only mode was lost during capture');
      const bounds = await screen.boundingBox();
      results.push({ story, viewport, bounds, dimensions, errors, apiCalls: api.length });
      await context.close();
    }
  }
} finally { await browser.close(); }
await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ screenshots: results.length, errors: results.filter(row => row.errors.length || row.apiCalls) }));
if (results.some(row => row.errors.length || row.apiCalls)) process.exitCode = 1;
