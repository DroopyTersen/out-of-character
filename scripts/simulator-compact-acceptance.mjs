import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/simulator-compact-acceptance';
const baseUrl = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];

function check(value, message) { if (!value) throw new Error(message); }

async function runCase(route, width, run) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 800 : width === 390 ? 844 : 941 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__micCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => {
      window.__micCalls++;
      return Promise.reject(new Error('Workshop must not request a microphone'));
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const apiCalls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', request => { apiCalls.push(request.request().url()); return request.abort(); });
  try {
    const response = await page.goto(`${baseUrl}/storybook/simulator-${route}`, { waitUntil: 'networkidle' });
    check(response?.status() === 200, `${route} returned HTTP ${response?.status()}`);
    const observations = await run(page);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    check(dimensions.document <= dimensions.viewport + 1, `horizontal overflow ${dimensions.document} > ${dimensions.viewport}`);
    check(apiCalls.length === 0, `API calls: ${apiCalls.join(', ')}`);
    check(await page.evaluate(() => window.__micCalls) === 0, 'microphone requested');
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    results.push({ route, width, pass: true, observations, dimensions, apiCalls: 0, micCalls: 0, errors: [] });
  } catch (error) {
    await page.screenshot({ path: `${output}/${route}-${width}-failure.png`, fullPage: true }).catch(() => {});
    results.push({ route, width, pass: false, error: error.stack, apiCalls, errors });
  } finally { await context.close(); }
}

function geometry(page) {
  return page.evaluate(() => Object.fromEntries(['.sim-objectives', '.sim-skills'].map(selector => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    if (!box) throw new Error(`${selector} missing`);
    return [selector, { top: box.top + scrollY, height: box.height }];
  })));
}

function sameGeometry(before, after, label) {
  for (const selector of Object.keys(before)) {
    check(Math.abs(before[selector].top - after[selector].top) <= 1, `${label} shifted ${selector} top`);
    check(Math.abs(before[selector].height - after[selector].height) <= 1, `${label} changed ${selector} height`);
  }
}

async function fullWidthHint(hint) {
  const bounds = await hint.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, width: box.width, right: box.right, viewport: innerWidth, document: document.documentElement.scrollWidth };
  });
  check(Math.abs(bounds.left) <= 2 && Math.abs(bounds.width - bounds.viewport) <= 2 && Math.abs(bounds.right - bounds.viewport) <= 2, `hint is not edge-to-edge: ${JSON.stringify(bounds)}`);
  check(bounds.document <= bounds.viewport + 1, `full-width hint caused horizontal overflow: ${JSON.stringify(bounds)}`);
  return bounds;
}

for (const width of [390, 1672]) {
  await runCase('selection', width, async page => {
    check(await page.locator('.sim-selection meter, .sim-selection .sim-traits').count() === 0, 'client stats exposed on selection');
    const traits = page.locator('.workshop-client-stats');
    check(await traits.isVisible(), 'workshop-only client traits missing from selection');
    check(await traits.locator('meter').count() === 6, 'workshop-only client traits incomplete');
    await page.getByRole('button', { name: 'Screen only', exact: true }).click();
    check(!await traits.isVisible(), 'workshop-only client traits leaked into Screen only');
    return { productionClientStats: 0, workshopTraits: 6, screenOnlyHidden: true };
  });

  if (width === 1672) {
    await runCase('live', width, async page => {
      const controls = page.locator('.workshop-controls');
      for (let turn = 0; turn < 9; turn++) await controls.getByRole('button', { name: 'Next turn' }).click();
      const columns = await page.locator('.sim-live-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
      check(columns === 3, `desktop live grid has ${columns} columns instead of three`);
      check(await page.locator('.sim-portrait').evaluate(node => node.getBoundingClientRect().height >= 260), 'desktop portrait is not spacious');
      check(await page.locator('.sim-caption p').isVisible(), 'desktop caption missing');
      check(!await page.locator('.sim-caption p').innerText().then(text => text.includes('Say hello')), 'desktop caption did not advance');
      check(await page.getByRole('button', { name: 'Open session brief' }).count() === 0, 'mobile brief control visible on desktop');
      check(await page.getByRole('button', { name: 'End session' }).evaluate(node => !!node.closest('.sim-session-bar')), 'desktop End session left header');
      check(await page.getByRole('button', { name: 'Transcript', exact: true }).evaluate(node => !!node.closest('.sim-client-stage')), 'desktop call controls left client column');
      const preview = controls.getByLabel('Hint preview');
      await preview.selectOption({ label: 'Sample hint' });
      const hint = page.locator('.sim-live-grid .sim-hint');
      await hint.waitFor({ state: 'visible' });
      const first = await hint.innerText();
      check(await hint.evaluate(node => !['fixed', 'absolute'].includes(getComputedStyle(node).position)), 'desktop hint is floating instead of in flow');
      check(await page.getByRole('button', { name: 'Dismiss hint' }).count() === 0, 'desktop hint has mobile dismissal');
      await preview.selectOption({ label: 'Another hint' });
      check(await hint.innerText() !== first, 'desktop hint preview did not update');
      await preview.selectOption({ label: 'Concern' });
      check(await hint.evaluate(node => node.classList.contains('concern')), 'desktop concern not distinguished');
      const transcriptButton = page.getByRole('button', { name: 'Transcript', exact: true });
      await transcriptButton.click();
      const transcript = page.getByRole('region', { name: /Conversation transcript/i });
      await transcript.waitFor();
      check(await transcript.locator('article').count() === 9, 'desktop transcript missing ninth turn');
      check(await transcript.evaluate(node => node.contains(document.activeElement)), 'desktop transcript did not receive focus');
      check(await transcript.locator('.sim-transcript').evaluate(node => node.scrollTop < 4), 'desktop inline transcript no longer starts at the beginning');
      check(await page.getByRole('dialog', { name: /Conversation transcript/i }).count() === 0, 'desktop transcript became modal');
      await transcript.getByRole('button', { name: 'Close transcript' }).click();
      await transcript.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Transcript', null, { timeout: 1500 }).catch(() => {});
      check(await transcriptButton.evaluate(node => document.activeElement === node), 'desktop transcript Close did not restore focus');
      const traits = page.locator('.workshop-client-stats');
      check(await traits.isVisible(), 'workshop-only client traits missing from live');
      await page.getByRole('button', { name: 'Screen only', exact: true }).click();
      check(!await traits.isVisible(), 'workshop-only client traits leaked into desktop Screen only');
      return { columns, portrait: 'spacious', caption: true, inlineHint: true, inlineTranscript: 9, workshopTraitsHidden: true };
    });
    continue;
  }

  await runCase('live', width, async page => {
    const controls = page.locator('.workshop-controls');
    const next = controls.getByRole('button', { name: 'Next turn' });
    for (let turn = 0; turn < 8; turn++) await next.click();
    const preview = controls.getByLabel('Hint preview');
    const hint = page.locator('.sim-hint-toast');
    await preview.selectOption({ label: 'Sample hint' });
    await hint.waitFor({ state: 'visible' });
    const fullWidth = await fullWidthHint(hint);
    const firstHint = await hint.innerText();
    const original = await geometry(page);
    await page.getByRole('button', { name: 'Dismiss hint' }).click();
    await hint.waitFor({ state: 'hidden' });
    sameGeometry(original, await geometry(page), 'dismiss hint');
    const hintButton = page.locator('.sim-hint-button');
    check(await hintButton.getAttribute('aria-expanded') === 'false', 'dismissed hint toggle not collapsed');
    check(await hintButton.getAttribute('aria-label') === 'Show live hint', 'dismissed hint toggle name is wrong');
    await hintButton.click();
    await hint.waitFor({ state: 'visible' });
    sameGeometry(original, await geometry(page), 'reopen hint');
    check(await hintButton.getAttribute('aria-expanded') === 'true', 'reopened hint toggle not expanded');
    check(await hintButton.getAttribute('aria-label') === 'Hide live hint', 'open hint toggle name is wrong');
    await hintButton.click();
    await hint.waitFor({ state: 'hidden' });
    sameGeometry(original, await geometry(page), 'hide hint with lightbulb');
    check(await hintButton.getAttribute('aria-expanded') === 'false', 'lightbulb did not collapse hint');
    await hintButton.click();
    await hint.waitFor({ state: 'visible' });
    sameGeometry(original, await geometry(page), 'show hint with lightbulb');
    check(await hintButton.getAttribute('aria-expanded') === 'true', 'lightbulb did not reopen hint');
    await page.getByRole('button', { name: 'Dismiss hint' }).click();
    await next.click();
    await hint.waitFor({ state: 'hidden' });
    await preview.selectOption({ label: 'Another hint' });
    await hint.waitFor({ state: 'visible' });
    check(await hint.innerText() !== firstHint, 'distinct hint did not replace dismissed hint');
    await preview.selectOption({ label: 'Concern' });
    await hint.waitFor({ state: 'visible' });
    check(await hint.evaluate(node => node.classList.contains('concern')), 'concern not distinguished');
    await page.getByRole('button', { name: 'Dismiss hint' }).click();
    await hint.waitFor({ state: 'hidden' });
    await next.click();
    await hint.waitFor({ state: 'hidden' });
    await preview.selectOption({ label: 'Sample hint' });
    await preview.selectOption({ label: 'Concern' });
    await hint.waitFor({ state: 'visible' });
    check(await hint.evaluate(node => node.classList.contains('concern')), 'cleared concern did not resurface when repeated');
    await preview.selectOption({ label: 'No hint' });
    await hint.waitFor({ state: 'hidden' });

    await page.reload({ waitUntil: 'networkidle' });
    for (let turn = 0; turn < 9; turn++) await next.click();
    await preview.selectOption({ label: 'Sample hint' });
    await hint.waitFor({ state: 'visible' });
    await controls.getByLabel('Connection').selectOption('connecting');
    await hint.waitFor({ state: 'hidden' });
    await controls.getByLabel('Connection').selectOption('live');
    await preview.selectOption({ label: 'Another hint' });
    await hint.waitFor({ state: 'visible' });
    await controls.getByLabel('Connection').selectOption('ending');
    await hint.waitFor({ state: 'hidden' });
    await controls.getByLabel('Connection').selectOption('live');
    await preview.selectOption({ label: 'Concern' });
    await hint.waitFor({ state: 'visible' });
    await controls.getByLabel('Feedback').selectOption('unavailable');
    await hint.waitFor({ state: 'hidden' });

    await controls.getByLabel('Feedback').selectOption('recorded');
    await preview.selectOption({ label: 'No hint' });
    const briefButton = page.getByRole('button', { name: 'Open session brief' });
    await briefButton.click();
    const brief = page.getByRole('dialog', { name: 'Session brief' });
    await brief.waitFor();
    check(await brief.evaluate(node => {
      const box = node.getBoundingClientRect();
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    }), 'session brief extends outside the mobile viewport');
    check(await brief.locator('meter, .sim-traits').count() === 0, 'client stats exposed in session brief');
    await brief.getByRole('button', { name: 'Close session brief' }).click();
    await brief.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open session brief', null, { timeout: 1500 }).catch(() => {});
    check(await briefButton.evaluate(node => document.activeElement === node), 'brief close did not restore focus');
    await briefButton.click();
    await page.keyboard.press('Escape');
    await brief.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open session brief', null, { timeout: 1500 }).catch(() => {});
    check(await briefButton.evaluate(node => document.activeElement === node), 'brief Escape did not restore focus');

    const transcriptButton = page.getByRole('button', { name: 'Transcript', exact: true });
    await transcriptButton.click();
    const transcript = page.getByRole('dialog', { name: /Conversation transcript/i });
    await transcript.waitFor();
    check(await transcript.locator('article').count() === 9, 'transcript missing ninth turn');
    check(await transcript.evaluate(node => node.contains(document.activeElement)), 'transcript dialog lacks focus');
    const transcriptList = transcript.locator('.sim-transcript');
    await page.waitForFunction(() => {
      const list = document.querySelector('[role="dialog"] .sim-transcript');
      return list && list.scrollTop >= list.scrollHeight - list.clientHeight - 4;
    });
    const transcriptScroll = await transcriptList.evaluate(node => ({ top: node.scrollTop, maximum: node.scrollHeight - node.clientHeight }));
    check(transcriptScroll.maximum > 0, 'nine-turn mobile transcript did not exercise scrolling');
    await page.keyboard.press('Escape');
    await transcript.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Transcript', null, { timeout: 1500 }).catch(() => {});
    check(await transcriptButton.evaluate(node => document.activeElement === node), 'transcript Escape did not restore focus');

    await page.getByRole('button', { name: 'Screen only', exact: true }).click();
    check(!await page.locator('.sim-caption').isVisible(), 'mobile caption remained visible');
    check(!await page.locator('.workshop-client-stats').isVisible(), 'workshop-only client traits leaked into mobile Screen only');
    check(await page.locator('.sim-objectives li').count() === 5, 'five objectives not reachable');
    check(await page.locator('.sim-skill').count() === 7, 'seven skills not reachable');
    const end = page.getByRole('button', { name: 'End session' });
    check(await end.evaluate(node => !node.closest('.sim-session-bar')), 'End session remained in header');
    for (const button of [end, transcriptButton, page.getByRole('button', { name: 'Mic on' })]) {
      await button.scrollIntoViewIfNeeded();
      check(await button.evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
      }), `call dock control is not reachable at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 664 });
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const shortPhone = await page.evaluate(() => ({
      skillBottom: document.querySelector('.sim-skill:last-of-type')?.getBoundingClientRect().bottom,
      dockTop: document.querySelector('.sim-call-controls')?.getBoundingClientRect().top,
      dockBottom: document.querySelector('.sim-call-controls')?.getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
    check(shortPhone.skillBottom != null && shortPhone.dockTop != null && shortPhone.skillBottom <= shortPhone.dockTop, 'last skill cannot scroll above the short-phone dock');
    check(shortPhone.dockBottom <= shortPhone.viewport, 'short-phone dock extends below viewport');
    return { objectives: 5, skills: 7, hintDismissedAcrossRevision: true, concernResurfacedAfterClear: true, lightbulbToggle: true, dialogs: 2, geometryStable: true, fullWidthHint: fullWidth, transcriptScroll, shortPhone };
  });
}

await runCase('live', 320, async page => {
  const next = page.locator('.workshop-controls').getByRole('button', { name: 'Next turn' });
  for (let turn = 0; turn < 8; turn++) await next.click();
  await page.getByLabel('Hint preview').selectOption({ label: 'Sample hint' });
  const hint = page.locator('.sim-hint-toast');
  await hint.waitFor({ state: 'visible' });
  const fullWidth = await fullWidthHint(hint);
  const original = await geometry(page);
  await page.getByRole('button', { name: 'Dismiss hint' }).click();
  await hint.waitFor({ state: 'hidden' });
  sameGeometry(original, await geometry(page), '320px dismiss hint');
  return { fullWidthHint: fullWidth, geometryStable: true };
});

await browser.close();
await writeFile(`${output}/report.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify({ total: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).map(result => ({ route: result.route, width: result.width, error: result.error })) }));
if (results.some(result => !result.pass)) process.exitCode = 1;
