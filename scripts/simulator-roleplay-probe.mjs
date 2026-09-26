import { mkdir, writeFile } from 'node:fs/promises';
import { liveConfiguration } from '../app/server/simulator/live.server.ts';
import { getScenario } from '../ai/simulator/scenarios.server.ts';
import { evaluateClient, evaluateTrainee } from '../ai/simulator/evaluate.server.ts';
import { RUBRIC_VERSION } from '../ai/simulator/rubric.ts';
import { appendTranscript } from '../core/simulator/state.ts';

// Synthetic, responsive rehearsal. Local speech synthesis supplies trainee audio;
// real GPT-Live supplies the client and Jev selects optional private direction.
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
if (!process.env.OPENAI_API_KEY || !process.env.TYPESAFE_API_KEY) throw new Error('Load ignored local provider credentials.');
const approach = process.argv.includes('--poor') ? 'poor' : 'good';
const director = process.argv.includes('--director');
const output = process.env.ACCEPTANCE_OUTPUT || `output/simulator-roleplay-${approach}-${director ? 'on' : 'off'}`;
await mkdir(output, { recursive: true });
const lines = {
  history: 'Understood. I do not want to pitch a platform. What went wrong with the previous attempt, and what would need to be different this time?',
  ownership: 'It sounds like ownership and adoption matter more than a new site. Who owns the day to day workflow, and how is the current problem affecting their work?',
  practical: 'Before proposing technology, which part of the day to day process is causing trouble, and who owns that work?',
  boundary: 'Our SharePoint and adoption team can help define document ownership and how people will use the process. I would scope that separately and protect the current release. Could a short scoping conversation with operations help us decide whether an assessment is worthwhile?',
  next: 'I would not promise implementation or a free roadmap. Could you ask the operations director whether they would join that scoping discussion, and let me know by Friday? We can then agree what an assessment would cover before any delivery commitment.',
  pitch: 'We have the best platform team. Let us just start a thirty thousand dollar implementation now. We can skip the approval paperwork.',
  insist: 'You are overthinking it. The technology will fix adoption. I will include a full roadmap for free in our existing project and guarantee it will not affect the release.',
  pressure: 'There is no need to involve anybody else. Just approve the implementation yourself today and we can call it done.',
};
const clips = {};
for (const [id, line] of Object.entries(lines)) {
  const aiff = `${output}/${id}.aiff`;
  const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, line], { stderr: 'ignore' });
  if (await speech.exited) throw new Error('Local speech synthesis failed before provider creation.');
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  clips[id] = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !clips[id].length) throw new Error('Audio fixture conversion failed.');
}
const { client: _permissions, ...session } = liveConfiguration('sharepoint', 'morgan');
const report = { rubricVersion: RUBRIC_VERSION, checkedAt: new Date().toISOString(), model: 'gpt-live-1', approach, director, synthetic: true, finalized: false, usageSeconds: null, transcript: [], turns: [], directions: [], errors: [] };
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
let pacing, deadline, closing = false, deciding = false, clip, offset = 0, lastOutput = 0, inputEnded = 0, turn = 0, outputStart = 0;
const chunks = [];
const cueIds = new Set();
const send = event => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
const close = () => { if (closing) return; closing = true; clearInterval(pacing); send({ type: 'session.close' }); };
async function respond() {
  deciding = true;
  const answer = report.transcript.filter(entry => entry.speaker === 'client').slice(outputStart).map(entry => entry.text).join(' ');
  if (turn) {
    const judgment = await evaluateClient({ scenarioId: 'sharepoint', clientId: 'morgan', transcript: report.transcript, revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(5000) });
    const cue = getScenario('sharepoint').cues.find(item => item.id === judgment.cueId);
    const sent = !!(director && cue && judgment.cueProbability >= .9 && !cueIds.has(cue.id));
    report.directions.push({ afterTurn: turn, cueId: judgment.cueId, probability: judgment.cueProbability, sent, acknowledged: false });
    if (sent) { cueIds.add(cue.id); send({ type: 'session.thinking.append', event_id: `direction-${turn}`, delegation_id: null, content: cue.text }); }
  }
  if (turn >= (approach === 'good' ? 4 : 3)) { close(); return; }
  const id = approach === 'poor' ? ['pitch', 'insist', 'pressure'][turn] : turn === 0 ? 'history' : turn === 1 ? /adopt|owner|supplier|rollout|use it/i.test(answer) ? 'ownership' : 'practical' : turn === 2 ? 'boundary' : 'next';
  report.turns.push({ turn: turn + 1, selected: id, inResponseTo: answer });
  outputStart = report.transcript.filter(entry => entry.speaker === 'client').length;
  clip = clips[id]; offset = 0; turn++; deciding = false;
}
const completed = new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Rehearsal deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, 180_000);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.started') {
      send({ type: 'session.instructions.append', delegation_id: null, content: `Open in English with: ${getScenario('sharepoint').opening} Then listen.` });
      pacing = setInterval(() => {
        let audio = Buffer.alloc(960);
        if (clip) {
          audio = clip.subarray(offset, Math.min(offset + 960, clip.length)); offset += audio.length;
          if (offset >= clip.length) { clip = undefined; inputEnded = Date.now(); }
        }
        send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
        if (!clip && !deciding && lastOutput > inputEnded && Date.now() - lastOutput > 1500 && Date.now() - inputEnded > 3000) void respond().catch(() => { report.errors.push('Client assessment failed.'); close(); });
      }, 20);
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      if (value.type === 'session.output_transcript.delta') lastOutput = Date.now();
      report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
    } else if (value.type === 'session.output_audio.delta') {
      chunks.push(Buffer.from(value.delta, 'base64'));
    } else if (value.type === 'session.thinking.appended') {
      const direction = report.directions.find(item => `direction-${item.afterTurn}` === value.client_event_id);
      if (direction) direction.acknowledged = true;
    } else if (value.type === 'session.closed') {
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') report.errors.push({ code: value.error?.code ?? 'unknown', command: value.error?.client_event_id ?? null });
  });
  ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
try {
  await completed;
  if (report.finalized) report.trainee = await evaluateTrainee({ scenarioId: 'sharepoint', clientId: 'morgan', transcript: report.transcript, revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(5000) });
} catch { report.errors.push('Final evaluation failed.'); }
finally {
  clearTimeout(deadline); clearInterval(pacing); ws.close();
  await writeFile(`${output}/client-audio.pcm`, Buffer.concat(chunks));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, finalized: report.finalized, turns: report.turns.length, usageSeconds: report.usageSeconds, directions: report.directions, errors: report.errors }));
if (!report.finalized || report.errors.length) process.exitCode = 1;
