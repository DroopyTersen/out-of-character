import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const check = (condition, message) => { if (!condition) throw new Error(message); };
await mkdir('output/voice-lab-acceptance', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => {
      window.__micCalls = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__micCalls++; throw new Error('Voice Lab requested a microphone.'); };
    });
    const page = await context.newPage();
    const errors = [], liveRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/api\/simulator\/|api\.openai\.com/.test(request.url())) liveRequests.push(request.url()); });
    try {
      await page.goto(`${base}/simulator/voice-lab`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Find the right voice for each client' }).waitFor();
      const audio = page.locator('audio');
      check((await audio.getAttribute('src'))?.endsWith('/morgan/meridian.mp3'), 'wrong initial sample');
      await audio.evaluate(element => element.play());
      await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .3);
      const first = await audio.elementHandle();
      await page.getByLabel('GPT-Live voice').selectOption('willow');
      check(await first.evaluate(element => element.paused && element.currentTime === 0), 'previous sample kept playing after a voice change');
      check((await audio.getAttribute('src'))?.endsWith('/morgan/willow.mp3'), 'voice change did not load a sample');
      await page.getByRole('button', { name: 'Jamie' }).click();
      check((await audio.getAttribute('src'))?.endsWith('/jamie/willow.mp3'), 'client change lost the selected voice');
      check((await page.locator('.sim-voice-lab-sample blockquote').textContent())?.includes('thoughtful proposal'), 'client transcript did not change');
      await audio.evaluate(element => element.play());
      await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .3);
      await page.getByRole('button', { name: 'Hear current voice' }).click();
      check((await audio.getAttribute('src'))?.endsWith('/jamie/coral.mp3'), 'current voice shortcut selected the wrong clip');
      await page.waitForFunction(() => document.activeElement?.tagName === 'AUDIO');
      await audio.evaluate(element => element.play());
      await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .3);
      check(await page.getByRole('alert').count() === 0, 'selected sample reported a playback error');
      const state = await page.evaluate(() => ({ mic: window.__micCalls, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
      check(state.mic === 0 && liveRequests.length === 0 && errors.length === 0, 'unexpected microphone, live request, or browser error');
      check(state.pageWidth <= state.viewportWidth + 1, 'horizontal overflow');
      await page.screenshot({ path: `output/voice-lab-acceptance/${width}.png`, fullPage: true });
      console.log(JSON.stringify({ width, playback: true, selection: true, state }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
