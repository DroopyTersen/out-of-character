import { writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.PROBE_HEADED !== 'true', args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.PROBE_AUDIO ?? '/tmp/ooc-positive.wav'}`, '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
await page.goto('https://out-of-character.droopy.workers.dev', { waitUntil: 'networkidle' });
await page.setContent('<button id="probe">Run synthetic selected-track recognition</button>');
await page.evaluate(() => {
  window.__nativeProbe = { constructor: null, events: [], results: [], errors: [], cleanup: null };
  const report = window.__nativeProbe;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  report.constructor = window.SpeechRecognition ? 'SpeechRecognition' : window.webkitSpeechRecognition ? 'webkitSpeechRecognition' : null;
  if (!Recognition) { report.finished = true; return; }
  document.querySelector('button').onclick = async () => {
    let stream, recognition, stopTimer, endTimer;
    const beginning = performance.now();
    const time = () => (performance.now() - beginning) / 1000;
    const finish = () => { clearTimeout(stopTimer); clearTimeout(endTimer); try { recognition?.abort(); } catch {} stream?.getTracks().forEach(track => track.stop()); report.cleanup = { liveTracks: stream?.getTracks().filter(track => track.readyState === 'live').length || 0 }; report.finished = true; };
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const device = devices.find(value => value.kind === 'audioinput');
      stream = await navigator.mediaDevices.getUserMedia({ audio: device ? { deviceId: { exact: device.deviceId } } : true });
      const track = stream.getAudioTracks()[0];
      report.track = { kind: track.kind, readyState: track.readyState, selectedDevice: !!device, actualDeviceMatches: !device || track.getSettings().deviceId === device.deviceId };
      recognition = new Recognition();
      recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US'; recognition.maxAlternatives = 1;
      report.startFunctionLength = recognition.start.length;
      report.processLocallySupported = 'processLocally' in recognition;
      for (const name of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'end']) recognition.addEventListener(name, () => { report.events.push({ type: name, time: time() }); if (name === 'end') finish(); });
      recognition.onresult = event => { for (let i = event.resultIndex; i < event.results.length; i++) { const result = event.results[i]; report.results.push({ time: time(), index: i, final: result.isFinal, text: result[0]?.transcript, confidence: result[0]?.confidence, resultKeys: Object.keys(result), alternativeKeys: Object.keys(result[0] || {}) }); } };
      recognition.onerror = event => { report.errors.push({ time: time(), error: event.error, message: event.message }); };
      recognition.start(track);
      report.startAccepted = true;
      stopTimer = setTimeout(() => { report.events.push({ type: 'requested-stop', time: time() }); recognition.stop(); }, 20000);
      endTimer = setTimeout(finish, 25000);
    } catch (error) { report.errors.push({ time: time(), name: error.name, message: error.message }); finish(); }
  };
});
await page.click('#probe');
await page.waitForFunction(() => window.__nativeProbe.finished === true, null, { timeout: 30000 });
const report = { checkedAt: new Date().toISOString(), browser: browser.version(), headless: process.env.PROBE_HEADED !== 'true', source: 'synthetic fake microphone WAV; explicit selected getUserMedia track', ...(await page.evaluate(() => window.__nativeProbe)) };
await mkdir('output', { recursive: true });
await writeFile(process.env.PROBE_OUTPUT || 'output/native-speech-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
await context.close(); await browser.close();
