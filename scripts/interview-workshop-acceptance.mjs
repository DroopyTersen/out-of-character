import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5174';
const output = process.env.ACCEPTANCE_OUTPUT || 'output/interview-streaming/browser/workshop';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const check = (value, message) => { if (!value) throw new Error(message); };
const capture = async (page, path) => {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true });
};
try {
  for (const width of [1440, 390, 320]) for (const screen of ['setup', 'live', 'summary']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.__micCalls = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.__micCalls++; throw new Error('Workshop opened microphone.'); };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
    try {
      await page.goto(`${base}/storybook/interview-${screen}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Screen only', exact: true }).click();
      await capture(page, `${output}/${screen}-${width}.png`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
      if (screen === 'live' && width < 500) {
        check(await page.locator('.interview-readings').evaluate(el => el.getBoundingClientRect().bottom < innerHeight), 'Mobile readings are below the first screen');
        await page.locator('.interview-topics').scrollIntoViewIfNeeded();
        check(await page.getByRole('button', { name: 'End interview', exact: true }).evaluate(el => el.getBoundingClientRect().top >= 0), 'End control scrolls out of reach');
      }
      if (screen === 'summary') {
        check(await page.locator('.interview-new').evaluate(el => el.getBoundingClientRect().top > document.querySelector('.interview-summary-transcript').getBoundingClientRect().top), 'New interview is above the transcript');
        for (const name of ['At a glance', 'Client experience', 'Internal delivery and process', 'Delivery and contributions']) {
          check(await page.getByRole('heading', { name, exact: true }).isVisible(), `Missing summary section: ${name}`);
        }
        check(await page.locator('.interview-summary-text li').count() === 3, 'Takeaways are not rendered as bullets');
        check(await page.locator('.interview-summary-text table tbody tr').count() === 4, 'Contributions table is missing');
        const diagram = page.locator('.interview-summary-text [data-streamdown="mermaid-block"]');
        await diagram.scrollIntoViewIfNeeded();
        await diagram.locator('svg[role="graphics-document document"]').waitFor();
        check((await diagram.innerText()).includes('Use smaller synthetic set'), 'Diagram content is missing');
        check(await page.locator('.interview-summary-text blockquote').count() === 1, 'Participant quote is missing');
        await capture(page, `${output}/${screen}-${width}.png`);
      }
      await page.getByRole('button', { name: 'Back to workshop controls', exact: true }).click();
      const controls = page.locator('.workshop-controls');
      if (screen === 'setup') {
        await page.getByRole('button', { name: 'Female voice', exact: true }).click();
        check(await page.getByRole('button', { name: 'Female voice', exact: true }).getAttribute('aria-pressed') === 'true', 'Voice selection did not change');
        await page.getByRole('button', { name: 'Start interview', exact: true }).click();
        await controls.getByLabel('Live interviews available').uncheck();
        check(await page.getByRole('button', { name: 'Start interview', exact: true }).isDisabled(), 'Disabled start remained enabled');
      } else if (screen === 'live') {
        await controls.getByLabel('Speaking').selectOption('client');
        check(await page.locator('.sim-voice-display').getAttribute('data-state') === 'client', 'Sam speaking state absent');
        await controls.getByLabel('Speaking').selectOption('listening');
        await page.getByRole('button', { name: 'Mic on', exact: true }).click();
        check(await page.getByRole('button', { name: 'Mic off', exact: true }).getAttribute('aria-pressed') === 'true', 'Mute state absent');
        await page.getByRole('button', { name: 'Transcript', exact: true }).click();
        check(await page.locator('#interview-live-transcript article').count() > 0, 'Transcript did not open');
        await page.locator('.interview-reading-evidence summary').click();
        check(await page.locator('.interview-reading-evidence blockquote').count() === 3, 'Reading evidence absent');
        await controls.getByLabel('Transcript').selectOption('0');
        check(await page.locator('.interview-topic li.heard').count() === 0, 'Empty transcript retains topic credit');
        check((await page.locator('.interview-reading-list').innerText()).includes('Not yet observed'), 'Empty transcript retains a reading');
        await controls.getByLabel('Call state').selectOption('ending');
        check(await page.getByRole('button', { name: 'Mic off', exact: true }).isDisabled(), 'Ending allows microphone input');
      } else {
        for (const status of ['pending', 'unavailable']) {
          await controls.getByLabel('Summary').selectOption(status);
          await page.getByRole('button', { name: 'Screen only', exact: true }).click();
          check(await page.locator('.interview-summary-state').isVisible(), 'Summary state absent');
          check(await page.getByRole('button', { name: 'Copy summary', exact: true }).count() === 0, 'Unavailable text is copyable');
          await capture(page, `${output}/summary-${width}-${status}.png`);
          await page.getByRole('button', { name: 'Back to workshop controls', exact: true }).click();
        }
        await controls.getByLabel('Summary').selectOption('writing');
        await page.getByRole('button', { name: 'Screen only', exact: true }).click();
        check(await page.getByRole('heading', { name: 'Writing your summary', exact: true }).isVisible(), 'Writing state absent');
        check(await page.locator('.interview-summary-text').isVisible(), 'Writing prose absent');
        check(await page.getByRole('button', { name: 'Copy summary', exact: true }).count() === 0, 'Draft summary is copyable');
        await capture(page, `${output}/summary-${width}-writing.png`);
        await page.getByRole('button', { name: 'Back to workshop controls', exact: true }).click();
        await controls.getByRole('button', { name: 'Replay stream', exact: true }).click();
        await page.getByRole('heading', { name: 'Writing your summary', exact: true }).waitFor();
        await page.locator('.interview-summary-text').waitFor();
        check(await page.getByRole('button', { name: 'Copy summary', exact: true }).count() === 0, 'Replay draft is copyable');
        await page.getByRole('button', { name: 'Copy summary', exact: true }).waitFor({ timeout: 8000 });
        check((await page.locator('.interview-summary-text').innerText()).includes('The interviewee described'), 'Replay did not finish with prose');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Replay caused horizontal overflow');
        await page.locator('.interview-summary-transcript summary').click();
        check(await page.locator('.interview-summary-transcript article').count() > 0, 'Transcript lost after summary failure');
      }
      check(await page.evaluate(() => window.__micCalls === 0), 'Workshop requested microphone');
      check(!requests.length && !errors.length, 'Workshop generated requests or browser errors');
      results.push({ screen, width, pass: true });
      console.log(`${screen} ${width}: passed`);
    } catch (error) { results.push({ screen, width, pass: false, error: error.message, errors, requests }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, results }));
if (results.some(result => !result.pass)) process.exitCode = 1;
