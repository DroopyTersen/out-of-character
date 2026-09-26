import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-failures';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
for (const mode of ['denied', 'creation-failed', 'cancel-pending-mic']) {
  const context = await browser.newContext();
  await context.addInitScript(mode => {
    window.__tracks = [];
    const stream = () => {
      const audio = new AudioContext();
      const destination = audio.createMediaStreamDestination();
      window.__tracks.push(...destination.stream.getTracks());
      return destination.stream;
    };
    navigator.mediaDevices.getUserMedia = () => mode === 'denied' ? Promise.reject(new DOMException('Denied', 'NotAllowedError')) : mode === 'cancel-pending-mic' ? new Promise(resolve => { window.__resolveMic = () => resolve(stream()); }) : Promise.resolve(stream());
  }, mode);
  const page = await context.newPage();
  const calls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/simulator/sessions**', route => {
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: route.request().url().endsWith('/sessions') ? 502 : 200, contentType: 'application/json', body: JSON.stringify(route.request().url().endsWith('/sessions') ? { error: 'The voice service is unavailable.' } : { ended: true }) });
  });
  try {
    await page.goto(`${process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173'}/simulator`);
    await page.getByRole('button', { name: 'Start simulation' }).click();
    if (mode === 'cancel-pending-mic') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(() => window.__resolveMic());
      await page.waitForTimeout(300);
    } else await page.getByRole('alert').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Start simulation' }).waitFor();
    const ended = await page.evaluate(() => window.__tracks.every(track => track.readyState === 'ended'));
    if (!ended) throw new Error('Microphone track remained active.');
    if (mode !== 'creation-failed' && calls.length) throw new Error('Created a session without microphone consent.');
    if (errors.length) throw new Error(errors.join('; '));
    await page.screenshot({ path: `${output}/${mode}.png`, fullPage: true });
    results.push({ mode, pass: true, providerBoundary: 'HTTP creation fails locally; no provider calls', tracksEnded: ended, calls });
  } catch (error) { results.push({ mode, pass: false, error: error.message, calls }); }
  await context.close();
}
await browser.close();
await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
if (results.some(result => !result.pass)) process.exitCode = 1;
