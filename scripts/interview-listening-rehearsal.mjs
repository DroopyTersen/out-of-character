import { generateText, Output } from 'ai';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { z } from 'zod';
import { foundryConfig, foundryProvider } from '../ai/foundry.server.ts';
import { yieldsTurn } from '../core/interview.ts';

// Listening-hold rehearsal through the real browser and server: the interview page in headless Chrome against a local
// dev server, with a synthetic microphone. A fictional participant, written turn by turn by the
// fast model and voiced by local speech synthesis, answers Sam's questions and pauses inside some answers (1.5-5 s, after
// a finished sentence or a hanging clause, or a breath). With --noise=brown, a fan-like brown noise bed plays under the
// microphone throughout. Measures, from Sam's audio as the page plays it and the server's archived notes: hold, turn and
// cancel notes; Sam taking over inside a pause; listening sounds; the time from a finished answer to Sam's question;
// participant passages transcribed outside their answers; and, per handover, how long the floor had been quiet, where
// the voice service placed the event against Sam's first words, and whether Sam's question took up its thread note.
// Usage: bun --env-file=.dev.vars scripts/interview-listening-rehearsal.mjs --paid [--label=a] [--answers=6] [--noise=brown]
// Needs the dev server (ACCEPTANCE_URL, default http://127.0.0.1:5174) with migrated local D1. Reports go to output/ (gitignored).
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const answers = Number(option('answers') ?? 6);
if (!(answers >= 2 && answers <= 10)) throw new Error('--answers must be 2 to 10.');
const noise = option('noise') ?? null;
if (noise != null && noise !== 'brown') throw new Error('--noise must be brown.');
const base = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:5174';
const output = `output/interview-listening/handover-${option('label') ?? 'a'}`;
const foundry = foundryConfig(process.env);
const provider = foundryProvider(foundry);
const BYTES_PER_MS = 48; // 24 kHz mono 16-bit PCM
const PAUSES_MS = [1500, 2500, 3500, 5000];
const SAM_DONE_MS = 1200;
const HELLO_AFTER_MS = 20_000;
const DEADLINE_MS = 9 * 60_000;
const SOUND_MS = 700; // Shorter audible stretches are listening sounds, longer ones speech.
const LAG_MS = 1250; // How far a note can trail the audio it answers: the transcript arrives about a second behind speech.
const NOISE_RMS = .03; // A fan or air conditioner near a laptop microphone, against speech at about .1.

const PERSONA = `You are Jordan, a software developer, in a voice interview with Sam, who is collecting lessons from a project Jordan just finished. Everything below is fictional; use only these facts. If Sam asks about something they don't cover, say briefly that you don't know or weren't involved.
Project: an eight-month booking portal for Metro Valley Transit, a regional bus agency, so riders could book paratransit trips online instead of phoning.
Your role: API lead for the first six months. In month six you rotated to another client and handed the API to Dana. You only heard secondhand that launch went fine.
Team: Priya, tech lead, who ran the data pipeline; Dana, developer, who took over the API; Marcus, part-time QA; Elise, project manager.
Client: Ruth, the agency's operations director, approved everything, and approvals took one to three weeks. Their IT security review took three weeks and blocked the first deploy. Dispatchers were the real users and were skeptical until Priya rode along on a dispatch shift.
Stories you can tell when asked: a payments vendor whose date format didn't match, caught because both teams tested one shared example payload before coding; a weekly working demo that replaced a big signoff document, where dispatchers spotted that cancellations needed a confirmation step; the client had no cloud environment and setup wasn't in the estimate, so two days of feature work slipped a week; your handoff, where Dana deployed from your runbook while you watched and found a missing environment variable, and you fixed the runbook before leaving; Playwright end-to-end tests that were flaky for a month until Marcus isolated test data; and what you'd change: check environment readiness before estimating, and get a dispatcher into sprint reviews from week one.
Speak as plain spoken English, two to four sentences, sometimes starting with "Yeah," or "So,". No lists or markdown. Answer what Sam actually asked, and don't retell a story you've already told.`;

process.umask(0o077);
await mkdir(`${output}/clips`, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
let clipCount = 0;
async function pcm(args) {
  const run = Bun.spawn(['ffmpeg', '-loglevel', 'error', ...args, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const audio = Buffer.from(await new Response(run.stdout).arrayBuffer());
  if (await run.exited || !audio.length) throw new Error('Audio conversion failed.');
  return audio;
}
async function speech(text) {
  const aiff = `${output}/clips/${++clipCount}.aiff`;
  if (await Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, text], { stderr: 'ignore' }).exited) throw new Error('Local speech synthesis failed.');
  return pcm(['-i', aiff]);
}
const breath = async () => Buffer.concat([await pcm(['-f', 'lavfi', '-i', 'anoisesrc=d=0.45:c=pink:a=0.12:r=24000,highpass=f=350,lowpass=f=2800,afade=t=in:d=0.18,afade=t=out:st=0.25:d=0.2']), Buffer.alloc(400 * BYTES_PER_MS)]);
/** A seamless loop of brown noise at NOISE_RMS: the tail is crossfaded into the head. */
async function noiseBed() {
  const raw = await pcm(['-f', 'lavfi', '-i', 'anoisesrc=d=21:c=brown:a=0.5:r=24000,highpass=f=40']);
  const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2), fade = 24_000, length = samples.length - fade;
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) / 32768;
  const loop = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const value = i < fade ? samples[i] * (i / fade) + samples[length + i] * (1 - i / fade) : samples[i];
    loop[i] = Math.max(-32768, Math.min(32767, Math.round(value * NOISE_RMS / rms)));
  }
  return Buffer.from(loop.buffer);
}
const wav = audio => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
};

let answerCount = 0, pauseCount = 0;
/**
 * Pauses in a fixed cycle: after a finished first sentence; after a hanging clause; a breath only; none; before the
 * last sentence.
 */
function hesitate(text) {
  const sentences = text.match(/[^.!?]+[.!?]+[”’"]?\s*|[^.!?]+$/g)?.map(item => item.trim()).filter(Boolean) ?? [text];
  const step = answerCount++ % 5;
  const parts = [];
  sentences.forEach((sentence, index) => {
    if (step === 1 && index === 0 && /,/.test(sentence)) {
      const at = sentence.indexOf(',') + 1;
      parts.push({ text: sentence.slice(0, at) }, { pause: 'hanging' }, { text: sentence.slice(at).trim() });
    } else parts.push({ text: sentence });
    if (index === sentences.length - 1) return;
    if ((step === 0 && index === 0) || (step === 4 && index === sentences.length - 2)) parts.push({ pause: 'finished' });
    if (step === 2 && index === 0) parts.push({ pause: 'breath' });
  });
  return parts;
}
async function voice(parts) {
  const chunks = [], pauses = [];
  let length = 0;
  for (const part of parts) {
    const audio = part.text ? await speech(part.text) : part.pause === 'breath' ? await breath() : Buffer.alloc(PAUSES_MS[pauseCount++ % PAUSES_MS.length] * BYTES_PER_MS);
    if (part.pause) pauses.push({ kind: part.pause, startMs: Math.round(length / BYTES_PER_MS), ms: Math.round(audio.length / BYTES_PER_MS) });
    chunks.push(audio); length += audio.length;
  }
  return { audio: wav(Buffer.concat(chunks)), pauses, lengthMs: Math.round(length / BYTES_PER_MS) };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const clips = new Map();
if (noise) clips.set('noise.wav', wav(await noiseBed()));
await context.route('**/__rehearsal/*.wav', route => route.fulfill({ contentType: 'audio/wav', body: clips.get(new URL(route.request().url()).pathname.split('/').at(-1)) }));
await context.addInitScript(({ soundMs, noise }) => {
  const NativePeer = RTCPeerConnection;
  const audit = window.__rehearsal = { sam: [], playing: null };
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) {
      super(...args);
      this.addEventListener('track', event => {
        const meter = new AudioContext(), analyser = meter.createAnalyser();
        meter.createMediaStreamSource(event.streams[0] || new MediaStream([event.track])).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => {
          if (event.track.readyState === 'ended') { clearInterval(timer); void meter.close(); return; }
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          if (rms <= .01) return;
          const now = Date.now(), last = audit.sam.at(-1);
          if (last && now - last.end <= 300) last.end = now;
          else audit.sam.push({ start: now, end: now });
        }, 40);
        void meter.resume();
      });
    }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const source = new AudioContext(), destination = source.createMediaStreamDestination();
    // A silent tone keeps the microphone track sending: the voice service waits for its audio.
    const tone = source.createOscillator(), silence = source.createGain();
    silence.gain.value = 0;
    tone.connect(silence).connect(destination);
    tone.start();
    await source.resume();
    if (noise) {
      const bed = source.createBufferSource();
      bed.buffer = await source.decodeAudioData(await fetch('/__rehearsal/noise.wav').then(response => response.arrayBuffer()));
      bed.loop = true;
      bed.connect(destination);
      bed.start();
    }
    audit.play = async name => {
      const buffer = await source.decodeAudioData(await fetch(`/__rehearsal/${name}`).then(response => response.arrayBuffer()));
      const node = source.createBufferSource();
      node.buffer = buffer;
      node.connect(destination);
      return new Promise(resolve => {
        node.onended = () => { audit.playing.end = Date.now(); resolve(audit.playing); };
        audit.playing = { name, start: Date.now(), end: null };
        node.start();
      });
    };
    return destination.stream;
  };
  void soundMs;
}, { soundMs: SOUND_MS, noise });

const page = await context.newPage();
const report = { checkedAt: new Date().toISOString(), base, noise, lines: [], hellos: 0, sessionId: null, errors: [] };
let transcript = [], status = null, lastSamChangeAt = 0, lastSamText = '';
/** When this script first saw each transcript entry, and each time its text grew: when the server learned their words. */
const seen = new Map(), growth = new Map();
page.on('pageerror', error => report.errors.push(`Page error: ${error.message}`));
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path === '/api/simulator/sessions' && request.method() === 'POST') report.sessionId = request.postDataJSON()?.id ?? null;
});
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (!/^\/api\/simulator\/sessions(?:\/|$)/.test(path)) return;
  try {
    const body = await response.json(), snapshot = body.snapshot || body;
    if (!snapshot?.status) return;
    status = snapshot.status;
    transcript = snapshot.transcript ?? transcript;
    for (const entry of transcript) {
      if (!seen.has(entry.id)) seen.set(entry.id, Date.now());
      const grew = growth.get(entry.id) ?? [];
      if (grew.at(-1)?.length !== entry.text.length) growth.set(entry.id, [...grew, { at: Date.now(), length: entry.text.length, endMs: entry.endMs }]);
    }
    const sam = transcript.filter(entry => entry.speaker === 'client').map(entry => entry.text).join(' ');
    if (sam !== lastSamText) { lastSamText = sam; lastSamChangeAt = Date.now(); }
  } catch { /* A non-JSON response is not a snapshot. */ }
});
const audit = () => page.evaluate(() => ({ sam: window.__rehearsal.sam }));
const until = async (check, timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (!await check()) { if (Date.now() >= end) return false; await page.waitForTimeout(150); }
  return true;
};
/** Sam has taken a substantive turn in passages first seen at or after `since`, and has been quiet for a moment. */
async function samDone(since) {
  const said = transcript.filter(entry => entry.speaker === 'client' && seen.get(entry.id) >= since).map(entry => entry.text).join(' ');
  if (!said.trim() || yieldsTurn(said)) return false;
  const last = (await audit()).sam.at(-1);
  return Date.now() - Math.max(last?.end ?? 0, lastSamChangeAt) >= SAM_DONE_MS;
}
/** Waits for Sam's turn after the clip that ended at `end`; false once nothing has come from Sam for `HELLO_AFTER_MS`, so a long question still counts. */
async function samTakesTurn(since, end) {
  while (!await samDone(since)) {
    const last = (await audit()).sam.at(-1);
    if (Date.now() - Math.max(end, last?.end ?? 0, lastSamChangeAt) >= HELLO_AFTER_MS) return false;
    await page.waitForTimeout(150);
  }
  return true;
}
const conversation = () => transcript.slice(-30).map(entry => `${entry.speaker === 'client' ? 'Sam' : 'Jordan'}: ${entry.text.trim()}`).join('\n');

const startedAt = Date.now();
try {
  await page.goto(`${base}/interview`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start interview' }).click();
  if (!await until(() => status === 'live', 25_000)) throw new Error('Interview did not become live.');
  if (!await samTakesTurn(0, Date.now())) throw new Error('Sam’s opening did not finish.');
  for (let index = 0; index < answers && Date.now() - startedAt < DEADLINE_MS; index++) {
    const result = await generateText({
      model: provider.responses(foundry.fastModel), providerOptions: { openai: { reasoningEffort: 'low', store: false } },
      output: Output.object({ schema: z.object({ reply: z.string().describe('Only the words Jordan says aloud.') }) }),
      system: PERSONA, prompt: `The interview so far:\n${conversation()}\n\nWrite Jordan's reply to Sam's latest turn.`,
    });
    const parts = hesitate(result.output.reply.trim());
    const { audio, pauses, lengthMs } = await voice(parts);
    const name = `${index + 1}.wav`;
    clips.set(name, audio);
    // Sam's reply is a passage that appears once the answer starts, not the question still finishing before it.
    const since = Date.now();
    const played = await page.evaluate(clip => window.__rehearsal.play(clip), name);
    const line = { index: index + 1, text: parts.map(part => part.text ?? `(${part.pause})`).join(' '), start: played.start, end: played.end, lengthMs, pauses: pauses.map(pause => ({ ...pause, start: played.start + pause.startMs, end: played.start + pause.startMs + pause.ms })) };
    report.lines.push(line);
    let done = await samTakesTurn(since, played.end);
    if (!done && report.hellos < 2) {
      report.hellos++;
      clips.set(`hello-${report.hellos}.wav`, (await voice([{ text: 'Hello? Are you still there?' }])).audio);
      line.hello = await page.evaluate(clip => window.__rehearsal.play(clip), `hello-${report.hellos}.wav`);
      done = await samTakesTurn(since, line.hello.end);
    }
    if (!done) { report.errors.push(`Sam did not take the turn after answer ${index + 1}.`); break; }
  }
} catch (error) { report.errors.push(error.message); }
finally {
  report.sam = (await audit().catch(() => ({ sam: [] }))).sam;
  report.transcript = transcript.map(({ id, speaker, text, startMs, endMs }) => ({ speaker, text, startMs, endMs, seenAt: seen.get(id) ?? null, growth: growth.get(id) ?? [] }));
  await page.getByRole('button', { name: 'End interview', exact: true }).click({ timeout: 3000 }).catch(() => report.errors.push('End interview did not complete.'));
  await until(() => status === 'ended' || status === 'interrupted', 30_000);
  report.status = status;
  await context.close();
  await browser.close();
}

// The archived producer records: the server's own account of the listening hold.
let row = null;
if (/^[0-9a-f-]{36}$/.test(report.sessionId ?? '')) {
  for (let attempt = 0; attempt < 12 && !row?.provenance_json; attempt++) {
    await Bun.sleep(5000);
    const query = Bun.spawn(['bunx', 'wrangler', 'd1', 'execute', 'out-of-character-simulator', '--local', '--json', '--command',
      `SELECT archive_state, provenance_json, interventions_json FROM interview_attempts WHERE id = '${report.sessionId}'`], { stdout: 'pipe', stderr: 'ignore' });
    const text = await new Response(query.stdout).text();
    await query.exited;
    try { row = JSON.parse(text)[0]?.results?.[0] ?? null; } catch { row = null; }
  }
}
const records = row ? JSON.parse(row.interventions_json).filter(record => record.source === 'note') : [];
const listening = row ? JSON.parse(row.provenance_json).contextualDirector?.listening ?? null : null;
report.notes = records.filter(record => record.kind === 'hold' || record.kind === 'cancel' || record.handover).map(({ kind, sentAt, quietMs, handover }) => ({ kind, sentAt, quietMs, handover }));
report.listening = listening;

// Per handover: one event carrying the latest notes with the turn note last. The voice service acknowledges an appended
// event once its timeline reaches the end of it (startMs/endMs, on the transcript's timeline); Sam's first words after
// the handover should start at or after that end. `before` is Sam speech that began between the participant's answer
// and the handover: speaking without permission.
report.handovers = records.filter(record => record.kind === 'turn' && record.handover).map(turn => {
  const parts = records.filter(record => record.delivery?.eventId === turn.delivery?.eventId);
  const { startMs = null, endMs = null, status = null, acknowledgedAt = null } = turn.delivery ?? {};
  const answer = report.transcript.findLast(entry => entry.speaker === 'trainee' && entry.seenAt != null && entry.seenAt <= turn.sentAt);
  const reply = startMs == null ? null : report.transcript.find(entry => entry.speaker === 'client' && entry.endMs > startMs && !yieldsTurn(entry.text));
  const before = report.transcript.filter(entry => entry.speaker === 'client' && answer && entry.startMs > answer.endMs && startMs != null && entry.startMs < startMs && !yieldsTurn(entry.text));
  return { sentAt: turn.sentAt, quietMs: turn.quietMs, parts: parts.map(record => record.kind), chars: parts.reduce((sum, record) => sum + record.text.length + 2, -2),
    status, ackMs: acknowledgedAt == null ? null : acknowledgedAt - turn.sentAt, eventMs: endMs == null ? null : endMs - startMs,
    replyAfterEndMs: reply && endMs != null ? reply.startMs - endMs : null, before: before.length,
    answer: answer?.text ?? null, reply: reply?.text ?? null, thread: parts.find(record => record.kind === 'list')?.text ?? null };
});
// Whether Sam's question took up the thread note handed over with the turn: a separate fast-model judgment.
const judged = report.handovers.filter(item => item.thread && item.reply);
if (judged.length) {
  try {
    const result = await generateText({
      model: provider.responses(foundry.fastModel), providerOptions: { openai: { reasoningEffort: 'low', store: false } },
      output: Output.object({ schema: z.object({ items: z.array(z.object({ index: z.number().int(), follows: z.enum(['note', 'participant', 'neither']) })) }) }),
      prompt: `For each item, an interviewer received a private note naming threads worth pulling, then asked the reply shown after the participant's answer. Say whether the reply asks about a thread the note names ("note"), only follows up on the participant's answer without a named thread ("participant"), or neither.\n\n${judged.map((item, index) => `Item ${index}\nNote: ${item.thread}\nAnswer: ${item.answer}\nReply: ${item.reply}`).join('\n\n')}`,
    });
    for (const { index, follows } of result.output.items) if (judged[index]) judged[index].follows = follows;
  } catch (error) { report.errors.push(`Thread judgment failed: ${error.message}`); }
}

// Per answer: what Sam did inside each pause, and between the end of the answer and the question.
const speechAfter = (from, to) => report.sam.filter(span => span.start >= from && span.start < to);
const analysis = report.lines.map((line, index) => {
  const next = report.lines[index + 1]?.start ?? Infinity;
  const inPauses = line.pauses.map(pause => {
    const spans = speechAfter(pause.start, pause.end + 250);
    return { kind: pause.kind, ms: pause.ms, sounds: spans.filter(span => span.end - span.start < SOUND_MS).length, takeover: spans.some(span => span.end - span.start >= SOUND_MS),
      notes: report.notes.filter(note => note.sentAt >= pause.start && note.sentAt < pause.end + LAG_MS).map(note => note.kind) };
  });
  const after = speechAfter(line.end, next);
  const question = after.find(span => span.end - span.start >= SOUND_MS);
  const turn = report.notes.find(note => note.kind === 'turn' && note.sentAt >= line.end - 250 && note.sentAt < next);
  return { index: line.index, pauses: inPauses, soundsBeforeQuestion: after.filter(span => span.end - span.start < SOUND_MS && (!question || span.start < question.start)).length,
    turnNoteMs: turn ? turn.sentAt - line.end : null, questionMs: question ? question.start - line.end : null, hello: !!line.hello };
});
const pauses = analysis.flatMap(item => item.pauses);
// Participant passages first seen outside every answer and its transcript lag: words the noise or Sam's audio made up.
const phantoms = report.transcript.filter(entry => entry.speaker === 'trainee' && entry.seenAt != null && entry.text.trim()
  && !report.lines.some(line => entry.seenAt >= line.start && entry.seenAt <= line.end + 3000 || line.hello && entry.seenAt >= line.hello.start && entry.seenAt <= line.hello.end + 3000)).map(entry => entry.text);
const times = analysis.map(item => item.questionMs).filter(value => value != null).sort((a, b) => a - b);
report.analysis = analysis;
report.result = {
  noise, counts: listening && { holds: listening.holds, handovers: listening.handovers, cancels: listening.cancels, wakes: listening.wakes },
  handovers: report.handovers.map(({ quietMs, parts, chars, status, ackMs, eventMs, replyAfterEndMs, before, follows }) => ({ quietMs, parts: parts.join('+'), chars, status, ackMs, eventMs, replyAfterEndMs, before, follows: follows ?? null })),
  phantoms,
  answers: report.lines.length, pauses: pauses.length, takeovers: pauses.filter(pause => pause.takeover).length,
  soundsInPauses: pauses.reduce((sum, pause) => sum + pause.sounds, 0), soundsBeforeQuestion: analysis.reduce((sum, item) => sum + item.soundsBeforeQuestion, 0),
  medianQuestionMs: times.length ? times[Math.floor(times.length / 2)] : null, questionMs: analysis.map(item => item.questionMs), turnNoteMs: analysis.map(item => item.turnNoteMs),
  hellos: report.hellos, status: report.status, archived: row?.archive_state ?? null, errors: report.errors,
};
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ output, ...report.result }, null, 2));
if (report.errors.length || !listening) process.exitCode = 1;
