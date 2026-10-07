import { generateText, Output } from 'ai';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { foundryConfig, foundryProvider, foundryUrl } from '../ai/foundry.server.ts';
import { evaluateInterview } from '../ai/interview/evaluate.server.ts';
import { settledPrefix } from '../ai/interview/map.server.ts';
import { interviewers, interviewOpening } from '../ai/interview/scenario.server.ts';
import { InterviewProducer, producerServices } from '../app/server/simulator/interview-producer.ts';
import { liveConfiguration, NO_EXTERNAL_TASK } from '../app/server/simulator/live.server.ts';
import { INTERVIEW_SCENARIO_ID, isBackchannel, mergeCoverage, yieldsTurn } from '../core/interview.ts';
import { appendTranscript, settledTranscript } from '../core/simulator/state.ts';

// Realistic closeout rehearsal. A fictional participant, written turn by turn by the fast model and voiced by local
// speech synthesis, is interviewed by the live Sam with the real producer, timed as the server times it: from the
// participant's transcript and Sam's playback, with the silence watchdog. Early on they answer fully; from --wind minutes they tire and say so;
// they turn down Sam's first offer to stop, and ask to finish at Sam's second offer or at --stop minutes.
// A participant left waiting says "Hello? Are you still there?" after 15 s, as a real one did.
// Measures: when Sam offers to stop and how, how Sam ends, silences after finished answers and what broke them, and
// whether Sam closes without a recap or an interview-level "anything else".
// Usage: bun --env-file=.dev.vars scripts/interview-closeout-rehearsal.mjs --paid [--label=a] [--wind=8] [--stop=13]
// Reports and audio go to output/ (gitignored).
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const foundry = foundryConfig(process.env);
if (!process.env.TYPESAFE_API_KEY) throw new Error('Load ignored local provider credentials.');
const interviewerId = option('voice') ?? interviewers[0].id;
const wind = Number(option('wind') ?? 8), stop = Number(option('stop') ?? 13);
if (!(wind >= 2 && stop > wind && stop <= 18)) throw new Error('--wind and --stop must be minutes with 2 <= wind < stop <= 18.');
const output = `${process.env.ACCEPTANCE_OUTPUT || 'output/interview-closeout-rehearsal'}/${option('label') ?? new Date().toISOString().replace(/[:.]/g, '-')}`;
const FRAME = 960; // 20 ms of 24 kHz mono 16-bit PCM
const BYTES_PER_MS = 48;
const REPLY_AFTER_MS = 1200;
const STATEMENT_AFTER_MS = 2500;
const HELLO_AFTER_MS = 15_000;
const THINK_MS = 3000;
const DEADLINE_MS = (stop + 4) * 60_000;
const HELLO = 'Hello? Are you still there?';
const FINISH = 'I think that is everything I have. Can we wrap up here?';

const PERSONA = `You are Jordan, a software developer, in a voice interview with Sam, who is collecting lessons from a project Jordan just finished. Everything below is fictional; use only these facts. If Sam asks about something they don't cover, say briefly that you don't know or weren't involved.
Project: an eight-month booking portal for Metro Valley Transit, a regional bus agency, so riders could book paratransit trips online instead of phoning.
Your role: API lead for the first six months. In month six you rotated to another client and handed the API to Dana. You only heard secondhand that launch went fine.
Team: Priya, tech lead, who ran the data pipeline; Dana, developer, who took over the API; Marcus, part-time QA; Elise, project manager.
Client: Ruth, the agency's operations director, approved everything, and approvals took one to three weeks. Their IT security review took three weeks and blocked the first deploy. Dispatchers were the real users and were skeptical until Priya rode along on a dispatch shift.
Stories you can tell when asked: a payments vendor whose date format didn't match, caught because both teams tested one shared example payload before coding; a weekly working demo that replaced a big signoff document, where dispatchers spotted that cancellations needed a confirmation step; the client had no cloud environment and setup wasn't in the estimate, so two days of feature work slipped a week; your handoff, where Dana deployed from your runbook while you watched and found a missing environment variable, and you fixed the runbook before leaving; Playwright end-to-end tests that were flaky for a month until Marcus isolated test data; and what you'd change: check environment readiness before estimating, and get a dispatcher into sprint reviews from week one.
Speak as plain spoken English, one to four sentences, sometimes starting with "Yeah," or "So,". No lists or markdown. Answer what Sam actually asked, and don't retell a story you've already told. If a question is confusing or asks two things, say so the way a real person would, or answer the part you can.`;
const replySchema = z.object({
  samOfferedToStop: z.boolean().describe('Sam\'s latest turn offers the participant the choice to stop the interview now.'),
  samRecapped: z.boolean().describe('Sam\'s latest turn summarizes what the interview covered.'),
  samAskedAnythingElse: z.boolean().describe('Sam\'s latest turn asks an interview-level "anything else?" or "did we miss anything?", not one scoped to a single story.'),
  samQuestionCount: z.number().int().min(0).describe('How many distinct questions Sam\'s latest turn asks.'),
  samEnded: z.boolean().describe('Sam\'s latest turn ends the interview: a goodbye or closing thanks with no question or offer.'),
  reply: z.string().describe('Only the words Jordan says aloud: no speaker name, no description of Sam\'s turn.'),
});

if (!interviewers.some(item => item.id === interviewerId)) throw new Error('Unknown interviewer voice.');
process.umask(0o077);
await mkdir(`${output}/clips`, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
let clipCount = 0;
async function speech(text) {
  const aiff = `${output}/clips/${++clipCount}.aiff`;
  if (await Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, text], { stderr: 'ignore' }).exited) throw new Error('Local speech synthesis failed.');
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const audio = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !audio.length) throw new Error('Audio conversion failed.');
  return audio;
}
/** A reply's audio, with a thinking pause wherever the writer put "(pause)". */
async function voice(text) {
  const parts = text.split(/\s*\(pause\)\s*/i).filter(Boolean);
  const chunks = [];
  for (const [index, part] of parts.entries()) {
    if (index) chunks.push(Buffer.alloc(THINK_MS * BYTES_PER_MS));
    chunks.push(await speech(part));
  }
  return Buffer.concat(chunks);
}
const audible = audio => {
  let energy = 0;
  for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
  return audio.length > 0 && Math.sqrt(energy / (audio.length / 2)) > 200;
};

const session = { ...liveConfiguration(INTERVIEW_SCENARIO_ID, interviewerId), model: foundry.liveModel };
const report = {
  checkedAt: new Date().toISOString(), model: session.model, voice: session.audio.output.voice, wind, stop,
  lines: [], gaps: [], waits: [], hellos: 0, offers: [], recaps: [], anythingElse: [], multiQuestions: 0, samTurns: 0,
  finishAskedMs: null, ending: null, samEnded: null, transcript: [], providerErrors: [], errors: [], finalized: false, usageSeconds: null,
};
const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } });
const send = event => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(event)); return true; };
const provider = foundryProvider(foundry);
const passageUpdatedAt = new Map();
const settled = () => settledTranscript(report.transcript, passageUpdatedAt, Date.now());
const prefix = () => { const ready = new Set(settled()); return settledPrefix(report.transcript, entry => ready.has(entry)); };
const received = [];
let current = null, offset = 0, inputBytes = 0, inputStartedAt = 0, inputEnded = 0, lastOutput = 0, samCursor = 0, audibleUntil = 0;
let samSince = '', generating = false, closing = false, offersSeen = 0, coverage = [], grading = null, pacing, deadline;
const inputMs = () => Date.now() - inputStartedAt;
const startedAt = Date.now();
const producer = new InterviewProducer({
  // Short: Sol's cache key, which includes it, is capped at 64 characters.
  attemptId: `rh-${crypto.randomUUID()}`, startedAt, foundry, typesafeKey: process.env.TYPESAFE_API_KEY, services: producerServices,
  settled: prefix, coverage: () => coverage, send,
  talking: () => !!current || (() => { const ready = new Set(settled()); return report.transcript.some(entry => entry.speaker === 'trainee' && !ready.has(entry)); })(),
  transcript: () => report.transcript,
});
// As the browser reports it: how long Sam's playback has been quiet, on the playback clock.
const producerTimer = setInterval(() => {
  const now = Date.now();
  producer.hear(now, { outputQuietMs: audibleUntil ? Math.min(60_000, Math.max(0, now - audibleUntil)) : null });
  producer.tick(now);
}, 100);
const close = () => { if (closing) return; closing = true; clearTimeout(pacing); clearInterval(producerTimer); producer.close(); send({ type: 'session.close' }); };

function play(text, kind) {
  return voice(text).then(audio => {
    current = audio; offset = 0;
    report.lines.push({ kind, atMs: inputMs(), text, lengthMs: Math.round(audio.length / BYTES_PER_MS) });
    samSince = '';
  });
}
const conversation = () => report.transcript.slice(-40).map(entry => `${entry.speaker === 'client' ? 'Sam' : 'Jordan'}: ${entry.text.trim()}`).join('\n');
async function reply() {
  generating = true;
  const minutes = inputMs() / 60_000;
  try {
    const result = await generateText({
      model: provider.responses(foundry.fastModel),
      providerOptions: { openai: { reasoningEffort: 'low', store: false } },
      output: Output.object({ schema: replySchema }),
      system: PERSONA,
      prompt: `The interview so far:\n${conversation()}\n\nIt is ${minutes.toFixed(1)} minutes in. ${minutes < wind
        ? 'Answer fully, with a concrete detail. In about one answer in four, put "(pause)" once mid-sentence where you would stop to think.'
        : 'You are getting tired and have told most of your stories: keep it short, and say once in a while that you think you have covered most of what you have.'}`
        + (offersSeen === 0 ? ' If Sam just offered to stop, say you can keep going a little and take up one of the things Sam named.' : '')
        + '\nFirst label Sam\'s latest turn, then write Jordan\'s reply.',
      maxOutputTokens: 600, maxRetries: 1, abortSignal: AbortSignal.timeout(20_000),
    });
    const label = result.output;
    const atMs = inputMs();
    report.samTurns++;
    if (label.samQuestionCount > 1) report.multiQuestions++;
    if (label.samRecapped) report.recaps.push({ atMs, sam: samSince.trim() });
    if (label.samAskedAnythingElse) report.anythingElse.push({ atMs, sam: samSince.trim() });
    if (label.samOfferedToStop) { offersSeen++; report.offers.push({ atMs, sam: samSince.trim() }); }
    // Sam closed the interview on its own, before the participant asked to.
    if (label.samEnded && report.finishAskedMs == null) { report.samEnded = { atMs, sam: samSince.trim() }; close(); return; }
    // A second offer, or the stop time, ends it.
    if (offersSeen >= 2 || minutes >= stop) {
      report.finishAskedMs = atMs;
      await play(FINISH, 'finish');
    } else await play(label.reply, label.samOfferedToStop ? 'after-offer' : 'answer');
  } catch (error) {
    report.errors.push(`Participant reply failed (${error.name}).`);
    close();
  } finally { generating = false; }
}
function grade() {
  if (grading || closing) return;
  const transcript = [...report.transcript];
  grading = evaluateInterview({ scenarioId: INTERVIEW_SCENARIO_ID, clientId: interviewerId, transcript, revision: transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(15_000) })
    .then(graded => { if (!closing) coverage = mergeCoverage(coverage, graded.objectives); }, error => report.errors.push(`Grading failed (${error.name}).`))
    .finally(() => { grading = null; });
}

/** The participant's turn: after Sam's question and a short quiet, after Sam's goodbye to end, or a check-in after a long silence. */
function decide(now) {
  if (current || generating || closing) return;
  const quiet = now - Math.max(lastOutput, audibleUntil, inputEnded);
  const sam = samSince.trim();
  if (report.finishAskedMs != null) {
    if (sam && !isBackchannel(sam) && quiet >= 4000) { report.ending = { atMs: inputMs(), sam, question: sam.includes('?') }; close(); }
    else if (!sam && quiet >= HELLO_AFTER_MS) { report.ending = { atMs: inputMs(), sam: null, question: false }; close(); }
    return;
  }
  // Sam's turn is a question, or a prompt with no question mark ("Tell me about the handoff.") followed by a longer quiet.
  const asked = !!sam && (sam.includes('?') || (!yieldsTurn(sam) && quiet >= STATEMENT_AFTER_MS));
  if (asked && quiet >= REPLY_AFTER_MS) { void reply(); return; }
  // Sam is still owed the turn: a participant left waiting checks in.
  if (inputEnded && !asked && quiet >= HELLO_AFTER_MS) {
    report.waits.push({ afterMs: inputEnded - inputStartedAt, line: report.lines.at(-1)?.kind ?? null, sam, quietMs: quiet, hello: true });
    report.hellos++;
    void play(HELLO, 'hello');
  }
}

await new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Rehearsal deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, DEADLINE_MS);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  const pace = () => {
    let audio = Buffer.alloc(FRAME);
    if (current) {
      audio = current.subarray(offset, Math.min(offset + FRAME, current.length)); offset += audio.length;
      if (offset >= current.length) { current = null; inputEnded = Date.now(); report.gaps.push({ afterMs: inputEnded - inputStartedAt, line: report.lines.at(-1)?.kind ?? null, gapMs: null }); grade(); }
    }
    send({ type: 'session.input_audio.append', audio: Buffer.concat([audio, Buffer.alloc(FRAME - audio.length)]).toString('base64') });
    inputBytes += FRAME;
    decide(Date.now());
    if (!closing) pacing = setTimeout(pace, Math.max(0, inputStartedAt + inputBytes / BYTES_PER_MS - Date.now()));
  };
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.started') {
      send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: interviewOpening(interviewerId) });
      inputStartedAt = Date.now();
      pace();
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      if (value.type === 'session.output_transcript.delta') { lastOutput = Date.now(); samSince += value.delta; }
      const next = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
      const changed = next.find(entry => !report.transcript.includes(entry));
      report.transcript = next;
      if (changed) { passageUpdatedAt.set(changed.id, Date.now()); producer.transcriptChanged(changed, next[next.indexOf(changed) - 1]?.id ?? null); }
    } else if (value.type === 'session.output_audio.delta') {
      const audio = Buffer.from(value.delta, 'base64');
      // Played as it arrives, after anything still queued, on the input clock.
      const at = Math.max(inputBytes, samCursor);
      received.push([at, audio]); samCursor = at + audio.length;
      if (audible(audio)) {
        audibleUntil = inputStartedAt + samCursor / BYTES_PER_MS;
        // Silence from the end of the participant's line to Sam's first audible reply, on the playback clock.
        const gap = report.gaps.at(-1);
        if (gap && gap.gapMs == null && !current) gap.gapMs = Math.max(0, Math.round(at / BYTES_PER_MS - gap.afterMs));
      }
    } else if (value.type === 'session.thinking.appended' || value.type === 'session.instructions.appended') {
      producer.providerEvent(value.client_event_id, true, { startMs: value.start_ms, endMs: value.end_ms });
    } else if (value.type === 'session.delegation.created') {
      if (!closing && typeof value.delegation?.id === 'string') {
        const replied = send({ type: 'session.thinking.append', event_id: `role-guard-${value.delegation.id}`, delegation_id: value.delegation.id, content: NO_EXTERNAL_TASK });
        producer.delegation(value.delegation.id, value.delegation.target ?? null, replied);
      }
    } else if (value.type === 'session.closed') {
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') {
      report.providerErrors.push({ atMs: inputMs(), closing, error: value.error });
      const eventId = value.error?.client_event_id;
      if (typeof eventId === 'string' && eventId.startsWith('note-')) producer.providerEvent(eventId, false);
    }
  });
  ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
clearTimeout(deadline); clearTimeout(pacing); clearInterval(producerTimer); ws.close();
await grading;
await producer.settle();
const at = ms => Math.round(ms - startedAt + (startedAt - inputStartedAt));
report.producer = producer.summary();
report.notes = producer.records.filter(item => item.source === 'note').map(note => ({
  kind: note.kind, sentMs: at(note.sentAt), ...(note.decidedAt ? { decidedMs: at(note.decidedAt) } : {}), ...(note.offer ? { offer: true } : {}), ...(note.wake ? { wake: true } : {}),
  samMs: note.nextSamTurnAt ? at(note.nextSamTurnAt) : null, text: note.text,
}));
report.paceVerdicts = producer.records.filter(item => item.source === 'map' && item.pace).map(item => ({ atMs: at(item.startedAt), verdict: item.pace.verdict }));
report.records = producer.records;
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
// Sam's audio on the input clock, with the participant's lines, for listening review.
const length = Math.max(inputBytes, samCursor);
const mix = Buffer.alloc(length + (length % 2));
for (const [start, audio] of received) for (let i = 0; i + 1 < audio.length && start + i + 1 < mix.length; i += 2) mix.writeInt16LE(audio.readInt16LE(i), start + i);
await writeFile(`${output}/sam.pcm`, mix);
await Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `${output}/sam.pcm`, `${output}/sam.wav`], { stderr: 'ignore' }).exited;
const turnNotes = report.notes.filter(note => note.kind === 'turn');
console.log(JSON.stringify({
  output, minutes: +(inputMs() / 60_000).toFixed(1), usageSeconds: report.usageSeconds, samTurns: report.samTurns, multiQuestions: report.multiQuestions,
  offers: report.offers.map(item => `${(item.atMs / 60_000).toFixed(1)}m`), offerNotes: report.notes.filter(note => note.offer).map(note => `${(note.sentMs / 60_000).toFixed(1)}m`),
  recaps: report.recaps.length, anythingElse: report.anythingElse.length, ending: report.ending, samEnded: report.samEnded,
  gapsOver4s: report.gaps.filter(item => item.gapMs >= 4000).map(item => `${(item.afterMs / 1000).toFixed(0)}s:${(item.gapMs / 1000).toFixed(1)}`), hellos: report.hellos, turnNotes: turnNotes.map(note => ({ sentMs: note.sentMs, samMs: note.samMs })),
  errors: report.errors,
}));
if (!report.finalized || report.errors.length) process.exitCode = 1;
