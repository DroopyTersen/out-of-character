const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
import { writeFile, mkdir } from 'node:fs/promises';

const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-workshop';
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];

function check(value, message) { if (!value) throw new Error(message); }
async function width(page) { return page.evaluate(() => ({ inner: innerWidth, document: document.documentElement.scrollWidth })); }
async function test(route, viewport, run) {
  const label = `${route}-${viewport.width}`;
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__micCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__micCalls++; return Promise.reject(new Error('Workshop must not request microphone')); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const api = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', request => { api.push(request.request().url()); return request.abort(); });
  try {
    const response = await page.goto(`${baseUrl}/storybook/${route}`, { waitUntil: 'networkidle' });
    check(response?.status() === 200, `route HTTP ${response?.status()}`);
    check(await page.locator('.workshop-heading h2').count() === 1, 'workshop heading absent');
    await run(page);
    const dimensions = await width(page);
    check(dimensions.document <= dimensions.inner + 1, `document overflows: ${dimensions.document} > ${dimensions.inner}`);
    const mic = await page.evaluate(() => window.__micCalls);
    check(api.length === 0, `provider API requests: ${api.join(', ')}`);
    check(mic === 0, `microphone requests: ${mic}`);
    check(errors.length === 0, `JS errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
    results.push({ route, viewport, pass: true, dimensions, apiCalls: api.length, micCalls: mic, jsErrors: errors.length });
  } catch (error) {
    await page.screenshot({ path: `${output}/${label}-failure.png`, fullPage: true }).catch(() => {});
    results.push({ route, viewport, pass: false, error: error.message, apiCalls: api, jsErrors: errors });
  } finally { await context.close(); }
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  await test('simulator-selection', viewport, async page => {
    const scenarios = page.locator('.sim-scenario');
    check(await scenarios.count() === 9, 'initial scenario count');
    check(await page.locator('.sim-client-card').count() === 7, 'initial client count');
    check((await scenarios.last().innerText()).includes('The happy hour'), 'happy hour must be last');
    await scenarios.last().click();
    await page.locator('.sim-meta').getByText(/Open conversation/).waitFor();
    check(!(await page.locator('.sim-brief').innerText()).includes('Objectives'), 'happy hour has an agenda');
    for (const name of ['Morgan', 'Avery', 'Casey', 'Harper', 'Quinn', 'Riley', 'Jamie']) {
      await page.locator('.sim-client-card').filter({ hasText: name }).click();
      await page.locator('.sim-client-brief h3').getByText(name, { exact: true }).waitFor();
    }
    await page.screenshot({ path: `${output}/happy-hour-selection-${viewport.width}.png`, fullPage: true });
    for (const title of ['Just send me a proposal', 'We could build this ourselves', 'The courtesy call', 'The demo went too well', 'The swap request', 'Done, but not deployed']) {
      await scenarios.filter({ hasText: title }).click();
      await page.locator('.sim-brief summary').getByText('What you know going in', { exact: true }).waitFor();
      check(await page.locator('.sim-brief details[open] li').count() >= 2, `${title} is missing its public briefing`);
    }
    for (const name of ['Harper', 'Quinn', 'Riley', 'Jamie']) {
      await page.locator('.sim-client-card').filter({ hasText: name }).click();
      await page.locator('.sim-client-brief h3').getByText(name, { exact: true }).waitFor();
      await page.waitForFunction(() => {
        const portrait = document.querySelector('.sim-selected-portrait');
        return portrait?.complete && portrait.naturalWidth > 0;
      });
    }
    await page.screenshot({ path: `${output}/expanded-catalog-${viewport.width}.png`, fullPage: true });
    await page.getByLabel('Larger collection (illustrative)').check();
    check(await scenarios.count() === 15, 'expanded scenario count');
    check(await page.locator('.sim-client-card').count() === 13, 'expanded client count');
    const rail = page.locator('.sim-client-rail');
    const before = await rail.evaluate(node => node.scrollLeft);
    await page.getByRole('button', { name: 'Next clients' }).click();
    await page.waitForTimeout(400);
    check(await rail.evaluate(node => node.scrollLeft) > before, 'next-client button did not scroll');
    await page.locator('.sim-client-card').filter({ hasText: 'Avery' }).first().click();
    await page.locator('.sim-client-brief h3').getByText('Avery', { exact: true }).waitFor();
    check(await page.locator('.sim-client-brief h3').innerText() === 'Avery', 'Avery was not selected');
    await scenarios.nth(1).click();
    check(await scenarios.nth(1).getAttribute('aria-pressed') === 'true', 'scenario did not change');
    await page.locator('.sim-brief p').getByText(/You are the technical lead/).waitFor();
    await page.getByRole('button', { name: 'Toggle microphone error' }).click();
    check(await page.getByRole('alert').isVisible(), 'mic error state absent');
    await page.getByLabel('Live available').uncheck();
    check(await page.getByRole('button', { name: /Start simulation/ }).isDisabled(), 'unavailable state did not disable start');
  });
  await test('simulator-live', viewport, async page => {
    const controls = page.locator('.workshop-controls');
    await controls.getByRole('button', { name: 'Next turn' }).click();
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    const transcript = page.getByRole(viewport.width <= 720 ? 'dialog' : 'region', { name: /Conversation transcript/i });
    check(await transcript.locator('article').count() === 1, 'next turn did not enter the transcript');
    await transcript.getByRole('button', { name: 'Close transcript' }).click();
    await transcript.waitFor({ state: 'hidden' });
    await controls.getByRole('button', { name: 'Play', exact: true }).click();
    check(await controls.getByRole('button', { name: 'Pause', exact: true }).isVisible(), 'play did not change to pause');
    await page.waitForTimeout(1900);
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    check(Number(await controls.locator('input[type=range]').inputValue()) >= 2, 'play did not advance');
    await controls.getByRole('button', { name: 'Reset' }).click();
    check(await controls.locator('input[type=range]').inputValue() === '0', 'reset did not rewind');
    for (let i=0; i<9; i++) await controls.getByRole('button', { name: 'Next turn' }).click();
    check((await page.locator('.sim-objectives').innerText()).includes('4/5'), 'objective progress did not update at recorded checkpoint');
    check((await page.locator('.sim-skill strong').allTextContents()).some(value => /^\d\.\d$/.test(value)), 'skill score did not update at recorded checkpoint');
    await page.waitForFunction(() => {
      const skill = document.querySelector('.sim-skill');
      const reading = Number(skill.querySelector('strong').textContent);
      const track = skill.querySelector('.sim-skill-track').getBoundingClientRect().width;
      const fill = skill.querySelector('.sim-skill-track > span').getBoundingClientRect().width;
      return Math.abs(fill / track - reading / 4) < .03;
    });
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    check(await transcript.locator('article').count() === 9, 'transcript did not open with nine turns');
    await transcript.getByRole('button', { name: 'Close transcript' }).click();
    await transcript.waitFor({ state: 'hidden' });
    await controls.getByLabel('Connection').selectOption('connecting');
    check((await page.locator('.sim-speaking').innerText()).includes('Connecting'), 'connection state absent');
    await controls.getByLabel('Connection').selectOption('live');
    await controls.getByLabel('Session warning').selectOption('idle');
    check((await page.locator('.sim-session-warning').innerText()).includes('Still there?'), 'inactivity warning absent');
    await page.getByRole('button', { name: 'Continue practice' }).click();
    check(await page.locator('.sim-session-warning').count() === 0, 'continue did not clear warning');
    for (const warning of ['limit', 'capacity']) {
      await controls.getByLabel('Session warning').selectOption(warning);
      check(await page.locator('.sim-session-warning').isVisible(), `${warning} warning absent`);
      check(await page.getByRole('button', { name: 'Mic on', exact: true }).isEnabled(), `${warning} muted before the deadline`);
      await page.screenshot({ path: `${output}/${warning}-warning-${viewport.width}.png`, fullPage: true });
    }
    await controls.getByLabel('Session warning').selectOption('finishing');
    check(await page.getByRole('button', { name: 'Mic off', exact: true }).isDisabled(), 'automatic finish allows new speech');
    check(await page.getByRole('button', { name: 'End session', exact: true }).isEnabled(), 'manual End should remain available');
    await controls.getByLabel('Session warning').selectOption('none');
    await controls.getByLabel('Feedback').selectOption('delayed');
    check((await page.locator('.sim-skills').innerText()).includes('Latest available feedback'), 'delayed feedback absent');
    await controls.getByLabel('Feedback').selectOption('unavailable');
    check((await page.locator('.sim-skills').innerText()).includes('Feedback unavailable'), 'unavailable feedback absent');
  });
  await test('simulator-debrief', viewport, async page => {
    check((await page.locator('.sim-outcome').innerText()).includes('5 of 5'), 'full result missing');
    await page.getByLabel('Attempt').selectOption('scope-overpromise');
    check((await page.locator('.sim-notice').innerText()).includes('commitment'), 'overpromise concern absent');
    await page.locator('.sim-debrief-transcript summary').click();
    check(await page.locator('.sim-debrief-transcript article').count() === 3, 'overpromise transcript missing');
    await page.getByLabel('Unconfirmed ending').check();
    check((await page.locator('.sim-notice').allInnerTexts()).some(value => value.includes('did not confirm')), 'unconfirmed ending absent');
  });
  await test('simulator-judging', viewport, async page => {
    await page.getByRole('button', { name: 'Show full result' }).click();
    await page.getByText('Recording details', { exact: true }).click();
    check((await page.locator('.sim-lab-source .sim-lab-provenance').innerText()).includes('Trainee'), 'full result timing missing');
    check(await page.locator('.sim-director-readout').getByText(/Role fidelity/).isVisible(), 'client diagnostics missing');
    check(await page.locator('.sim-lab-checks span').count() > 0, 'fixture checks missing');
    await page.locator('.sim-objectives details').first().locator('summary').click();
    check(await page.locator('.sim-objectives blockquote').first().isVisible(), 'source evidence not visible');
    await page.getByText('Inspect raw typed judgments and distributions').click();
    check((await page.locator('.sim-debrief-transcript pre').innerText()).includes('probability'), 'raw judgments missing');
  });
  await test('simulator-live', viewport, async page => {
    await page.getByLabel('Conversation').selectOption('happy-hour');
    check(await page.locator('.sim-session-bar h1').innerText() === 'The happy hour', 'happy hour not selected');
    check(await page.locator('.sim-coaching, .sim-skills, .sim-hint-button').count() === 0, 'social conversation has coaching');
    await page.getByRole('button', { name: 'Next turn', exact: true }).click();
    await page.getByRole('button', { name: 'Transcript', exact: true }).click();
    const transcript = page.getByRole(viewport.width <= 720 ? 'dialog' : 'region', { name: /Conversation transcript/i });
    check((await transcript.innerText()).includes('tiny plate'), 'social transcript unavailable');
    await transcript.getByRole('button', { name: 'Close transcript' }).click();
    await transcript.waitFor({ state: 'hidden' });
    if (viewport.width <= 720) {
      await page.getByRole('button', { name: 'Open session brief' }).click();
      const brief = page.getByRole('dialog', { name: 'Session brief' });
      check(!(await brief.innerText()).includes('Your objectives'), 'social brief has an agenda');
      await brief.getByRole('button', { name: 'Close session brief' }).click();
      await brief.waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: 'Screen only', exact: true }).click();
    await page.screenshot({ path: `${output}/happy-hour-live-${viewport.width}.png`, fullPage: true });
  });
  await test('simulator-debrief', viewport, async page => {
    await page.getByLabel('Attempt').selectOption('happy-hour');
    check(await page.getByRole('heading', { name: 'Your conversation', exact: true }).isVisible(), 'social closing screen unavailable');
    check(await page.locator('.sim-outcome-count, .sim-takeaways, .sim-skills, .sim-objectives').count() === 0, 'social closing screen has scoring');
    check(!(await page.locator('.sim-debrief').innerText()).includes('unavailable'), 'unscored conversation reported missing feedback');
    await page.locator('.sim-debrief-transcript summary').click();
    check(await page.locator('.sim-debrief-transcript article').count() === 3, 'social transcript missing');
    await page.getByRole('button', { name: 'Screen only', exact: true }).click();
    await page.screenshot({ path: `${output}/happy-hour-ended-${viewport.width}.png`, fullPage: true });
  });
}
await browser.close();
await writeFile(`${output}/report.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).map(result => ({ route: result.route, width: result.viewport.width, error: result.error })) }, null, 2));

if (results.some(result => !result.pass)) process.exitCode = 1;
