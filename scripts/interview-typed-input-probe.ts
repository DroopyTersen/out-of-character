/**
 * Paid provider probe: does GPT-Live answer a typed participant answer forwarded as `session.thinking.append`?
 *
 *   bun --env-file=.dev.vars scripts/interview-typed-input-probe.ts --paid
 *
 * One voice session under the first hosted template's brief: the interviewer opens, the opening settles, then one
 * `typed-<uuid>` event carries `typedAnswerCue(...)` as the session actor sends it. The input is 24 kHz silence, so
 * any input transcript is the provider echoing the typed text. Records the ack, any correlated error, the spoken
 * response's transcript and any echo for a bounded window, then closes the session. Prints a JSON summary.
 *
 * The reference host opens sessions over WebRTC from a browser SDP offer, which Bun cannot make; like
 * interview-delivery-probe.mjs this uses the provider's WebSocket transport with the same brief, opening and events.
 * Listening is still the evidence that the reply is useful; the transcript here is supporting evidence.
 */
import { foundryConfig, foundryUrl } from '../ai/foundry.server';
import { templates } from '../app/server/interview/debriefs';
import { NO_EXTERNAL_TASK, typedAnswerCue } from '../interview-engine/interview/session/voice.prompt';
import { interviewerBrief, interviewOpening } from '../interview-engine/interview/voice/brief.server';

if (!Bun.argv.includes('--paid')) throw new Error('Pass --paid to open one voice session (about 40 seconds of GPT-Live).');
const foundry = foundryConfig(process.env);
const spec = templates[0]!;
const voice = spec.interviewer.voices[0]!;
const TYPED = 'I would rather type: the handoff took five days and now takes one.';
const typedId = `typed-${crypto.randomUUID()}`;
const SETTLE_MS = 2500, OPENING_LIMIT_MS = 20_000, WINDOW_MS = 20_000, CLOSE_LIMIT_MS = 10_000;
const FRAME = Buffer.alloc(960); // 20 ms of 24 kHz mono 16-bit PCM silence

const summary = {
  checkedAt: new Date().toISOString(), model: foundry.liveModel, spec: `${spec.id} ${spec.version}`, voice: voice.voice, typedId, typed: TYPED,
  started: false, opening: '', typedSentAt: null as number | null,
  appended: null as null | { type: string; afterMs: number },
  error: null as null | { code: unknown; message: unknown },
  response: { produced: false, firstDeltaAfterMs: null as number | null, text: '' },
  inputTranscript: { text: '', echoed: false },
  otherErrors: [] as unknown[], closed: false, usageSeconds: null as number | null,
};

const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } } as unknown as string[]);
const send = (event: Record<string, unknown>) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
let lastOutputAt = 0, openingStartedAt = 0;
let pacing: ReturnType<typeof setInterval> | undefined;
let closedSeen: () => void = () => {};
const closed = new Promise<void>(resolve => { closedSeen = resolve; });

ws.addEventListener('message', event => {
  if (typeof event.data !== 'string') return;
  const value = JSON.parse(event.data) as Record<string, any>;
  if (value.type === 'session.started') {
    summary.started = true;
    openingStartedAt = Date.now();
    send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: interviewOpening(spec, voice.id) });
    pacing = setInterval(() => send({ type: 'session.input_audio.append', audio: FRAME.toString('base64') }), 20);
  } else if (value.type === 'session.output_transcript.delta') {
    lastOutputAt = Date.now();
    if (summary.typedSentAt == null) summary.opening += value.delta;
    else {
      summary.response.produced = true;
      summary.response.firstDeltaAfterMs ??= Date.now() - summary.typedSentAt;
      summary.response.text += value.delta;
    }
  } else if (value.type === 'session.input_transcript.delta') {
    summary.inputTranscript.text += value.delta;
  } else if (typeof value.type === 'string' && value.type.endsWith('.appended') && value.client_event_id === typedId) {
    summary.appended = { type: value.type, afterMs: Date.now() - (summary.typedSentAt ?? Date.now()) };
  } else if (value.type === 'session.delegation.created' && value.delegation?.target === 'client') {
    // As the session actor does: the interviewer's own delegations are declined, never run.
    send({ type: 'session.thinking.append', event_id: crypto.randomUUID(), delegation_id: value.delegation.id, content: NO_EXTERNAL_TASK });
  } else if (value.type === 'error') {
    if (value.error?.client_event_id === typedId) summary.error = { code: value.error.code, message: value.error.message };
    else summary.otherErrors.push(value.error ?? value);
  } else if (value.type === 'session.closed') {
    summary.closed = true;
    summary.usageSeconds = typeof value.usage?.seconds === 'number' ? value.usage.seconds : null;
    closedSeen();
  }
});
ws.addEventListener('open', () => send({ type: 'session.start', session: {
  model: foundry.liveModel, instructions: interviewerBrief(spec, voice.id), store: false,
  audio: { output: { voice: voice.voice }, format: { type: 'audio/pcm', rate: 24000 } },
} }));
ws.addEventListener('close', () => closedSeen());

const until = async (done: () => boolean, ms: number) => {
  const expires = Date.now() + ms;
  while (!done() && Date.now() < expires) await Bun.sleep(100);
  return done();
};

try {
  // Ready, then a settled opening question: the typed answer arrives as an answer, not an interruption.
  if (!await until(() => summary.started, 15_000)) throw new Error('The voice session did not start.');
  await until(() => lastOutputAt > 0 && Date.now() - lastOutputAt > SETTLE_MS, OPENING_LIMIT_MS);
  summary.typedSentAt = Date.now();
  send({ type: 'session.thinking.append', event_id: typedId, delegation_id: null, content: typedAnswerCue(TYPED) });
  await until(() => summary.error != null, WINDOW_MS);
} catch (error) {
  summary.otherErrors.push(error instanceof Error ? error.message : String(error));
} finally {
  clearInterval(pacing);
  send({ type: 'session.close' });
  await Promise.race([closed, Bun.sleep(CLOSE_LIMIT_MS)]);
  ws.close();
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(word => word.length > 3);
const typedWords = new Set(words(TYPED));
const heard = words(summary.inputTranscript.text);
// Silence went in; most of the typed words coming back as participant speech means the provider echoed them.
summary.inputTranscript.echoed = heard.filter(word => typedWords.has(word)).length >= Math.ceil(typedWords.size / 2);
summary.response.text = summary.response.text.trim();
summary.opening = summary.opening.trim();
console.log(JSON.stringify({ ...summary, openingMs: openingStartedAt ? (summary.typedSentAt ?? Date.now()) - openingStartedAt : null }, null, 2));
process.exit(0);
