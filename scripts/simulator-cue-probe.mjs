import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { foundryConfig, foundryUrl } from '../ai/foundry.server.ts';
import { liveConfiguration } from '../app/server/simulator/live.server.ts';
import { getScenario } from '../ai/simulator/scenarios.server.ts';
import { appendTranscript } from '../core/simulator/state.ts';

if (!process.argv.includes('--paid')) throw new Error('Pass --paid to run this bounded provider probe.');
const foundry = foundryConfig(process.env);
const cueEnabled = process.argv.includes('--cue');
const output = process.env.ACCEPTANCE_OUTPUT || `output/simulator-cue-${cueEnabled ? 'on' : 'off'}`;
const audioPath = process.env.ACCEPTANCE_AUDIO || 'output/simulator-budget.wav';
await readFile(audioPath); // Validate before opening any paid connection.
const converter = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', audioPath, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
const pcm = Buffer.from(await new Response(converter.stdout).arrayBuffer());
if (await converter.exited || !pcm.length) throw new Error('Cannot prepare the supplied audio fixture.');
await mkdir(output, { recursive: true });
const report = { checkedAt: new Date().toISOString(), model: foundry.liveModel, synthetic: true, cueEnabled, cueForcedForProtocolProbe: cueEnabled, cueAcknowledged: false, finalized: false, usageSeconds: null, outputAudioBytes: 0, transcript: [], errors: [] };
// Fixed synthetic instruction tests the voice protocol independently of generation.
const cue = 'You can discuss a separately scoped assessment. Implementation still requires separate funding approval; do not approve delivery or speak for the operations director.';
const session = liveConfiguration('sharepoint', 'morgan');
session.model = foundry.liveModel;
const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } });
let started = false, closing = false, offset = 0, ticks = 0;
let pacing, deadline;
const outputAudio = [];
const send = value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
const close = () => { if (closing) return; closing = true; clearInterval(pacing); send({ type: 'session.close' }); };
const completed = new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Probe deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, 55_000);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.started') {
      started = true;
      send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: `Begin this meeting now in English: ${getScenario('sharepoint').opening} Then listen.` });
      pacing = setInterval(() => {
        ticks++;
        if (cueEnabled && ticks === 300) send({ type: 'session.instructions.append', event_id: 'probe-cue', delegation_id: null, content: cue });
        let chunk = Buffer.alloc(960);
        if (ticks > 450 && offset < pcm.length) { chunk = pcm.subarray(offset, Math.min(offset + 960, pcm.length)); offset += chunk.length; }
        send({ type: 'session.input_audio.append', audio: chunk.toString('base64') });
        if (ticks > 450 + Math.ceil(pcm.length / 960) + 650) close();
      }, 20);
    } else if (value.type === 'session.instructions.appended' && value.client_event_id === 'probe-cue') {
      report.cueAcknowledged = true;
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
    } else if (value.type === 'session.output_audio.delta') {
      const chunk = Buffer.from(value.delta, 'base64'); outputAudio.push(chunk); report.outputAudioBytes += chunk.length;
    } else if (value.type === 'session.closed') {
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') report.errors.push({ code: value.error?.code ?? 'unknown', command: value.error?.client_event_id ?? null });
  });
  ws.addEventListener('error', () => { report.errors.push('WebSocket transport error.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
try { await completed; }
finally {
  clearTimeout(deadline); clearInterval(pacing);
  if (started && !closing && !report.finalized) close();
  ws.close();
  await writeFile(`${output}/client-audio.pcm`, Buffer.concat(outputAudio));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, finalized: report.finalized, cueEnabled, cueAcknowledged: report.cueAcknowledged, outputAudioBytes: report.outputAudioBytes, errors: report.errors }));
if (!report.finalized || !report.outputAudioBytes || (cueEnabled && !report.cueAcknowledged) || report.errors.length) process.exitCode = 1;
