import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-voice';
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const check = (condition, message) => { if (!condition) throw new Error(message); };
const heights = page => page.locator('.sim-spectrum i').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
try {
  for (const width of [390, 1440]) for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
    const page = await context.newPage();
    const errors = [], api = [];
    let audio;
    await context.addInitScript(() => {
      window.__micCalls = 0;
      navigator.mediaDevices.getUserMedia = () => { window.__micCalls++; return Promise.reject(new Error('No microphone in workshop')); };
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/**', route => { api.push(route.request().url()); return route.abort(); });
    try {
      await page.goto(`${base}/storybook/simulator-voice`, { waitUntil: 'networkidle' });
      if (width === 1440 && reducedMotion === 'no-preference') {
        // Exercise the production reader with real browser audio, without speakers or a microphone.
        audio = await page.evaluate(async () => {
          const { readAudio } = await import('/interview-engine/client/audioLevels.ts');
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const stream = context.createMediaStreamDestination();
          const meter = context.createAnalyser();
          meter.fftSize = 1024;
          gain.gain.value = .2;
          oscillator.connect(gain).connect(stream);
          context.createMediaStreamSource(stream.stream).connect(meter);
          const sample = () => { const { level, bands } = readAudio(meter); return { level, peak: Math.max(...bands), band: bands.indexOf(Math.max(...bands)) }; };
          try {
            await context.resume();
            const quiet = sample();
            oscillator.frequency.value = 440;
            oscillator.start();
            await new Promise(resolve => setTimeout(resolve, 300));
            const low = sample();
            oscillator.frequency.value = 1800;
            await new Promise(resolve => setTimeout(resolve, 300));
            const high = sample();
            oscillator.stop();
            await new Promise(resolve => setTimeout(resolve, 350));
            return { quiet, low, high, stopped: sample() };
          } finally { stream.stream.getTracks().forEach(track => track.stop()); await context.close(); }
        });
        check(audio.quiet.level < .01 && audio.stopped.level < .01 && audio.stopped.peak === 0, 'real analyser does not return to silence');
        check(audio.low.level > .1 && audio.high.level > .1 && audio.high.band > audio.low.band + 3, 'real analyser does not distinguish voice frequencies');
        results.push({ analyser: true, pass: true, audio });
      }
      for (const state of ['client', 'trainee', 'overlap', 'listening', 'muted', 'connecting', 'ending']) {
        await page.getByLabel('Audio state').selectOption(state);
        await page.waitForTimeout(200);
        check(await page.locator('.sim-voice-display').getAttribute('data-state') === state, `wrong ${state} state`);
        const bands = await heights(page);
        const client = Math.max(...bands.slice(0, 24)), trainee = Math.max(...bands.slice(24));
        if (['client', 'overlap'].includes(state)) check(client > 8, 'client spectrum absent');
        if (['trainee', 'overlap'].includes(state)) check(trainee > 8, 'trainee spectrum absent');
        if (['listening', 'muted', 'ending'].includes(state)) check(client <= 2 && trainee <= 2, 'quiet state shows speech');
        await page.locator('.sim-voice-workbench').screenshot({ path: `${output}/${state}-${width}-${reducedMotion}.png` });
      }
      await page.getByLabel('Audio state').selectOption('overlap');
      await page.waitForTimeout(200);
      const first = await heights(page);
      await page.waitForTimeout(320);
      const next = await heights(page);
      check(JSON.stringify(first) === JSON.stringify(next) ? reducedMotion === 'reduce' : reducedMotion === 'no-preference', 'motion preference not respected');
      await page.getByRole('button', { name: 'Pause preview' }).click();
      await page.waitForTimeout(180);
      const paused = await heights(page);
      await page.waitForTimeout(240);
      check(JSON.stringify(paused) === JSON.stringify(await heights(page)), 'paused spectrum still advances');
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      check(await page.getByLabel('Audio state').inputValue() === 'client', 'reset did not restore client');
      await page.getByRole('button', { name: 'Replay all states' }).click();
      await page.waitForFunction(() => document.querySelector('.sim-voice-display')?.dataset.state === 'trainee', undefined, { timeout: 10000 });
      check(await page.locator('.sim-voice-display').getAttribute('data-state') === 'trainee', 'state replay did not advance');
      const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, mic: window.__micCalls }));
      check(dimensions.document <= width + 1, 'horizontal overflow');
      check(!dimensions.mic && !api.length && !errors.length, 'unexpected microphone, API, or page error');
      results.push({ width, reducedMotion, pass: true, states: 7, dimensions });
    } catch (error) { results.push({ width, reducedMotion, pass: false, error: error.message, errors, api, audio }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
if (results.some(row => !row.pass)) process.exitCode = 1;
