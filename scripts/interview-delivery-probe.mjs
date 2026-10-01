import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { foundryConfig, foundryUrl } from '../ai/foundry.server.ts';
import { interviewers, interviewerBrief, interviewOpening } from '../ai/interview/scenario.server.ts';
import { liveConfiguration, NO_EXTERNAL_TASK } from '../app/server/simulator/live.server.ts';
import { INTERVIEW_SCENARIO_ID } from '../core/interview.ts';
import { emptyMap } from '../core/interview-map.ts';
import { listNote, noteHeaders } from '../core/interview-notes.ts';
import { appendTranscript } from '../core/simulator/state.ts';
import { measure } from './lib/interview-delivery-measures.mjs';

// Delivery probe: does Sam take up a thread note, parrot its words, or mention it?
// Each run: Sam opens; a synthetic participant names three threads in one answer, and a
// hand-written thread note on the least salient one arrives while they are still speaking.
// Sam's next two turns are measured, then the participant asks to finish.
// Cells are <thinking|instructions>:<options|directions>:<gap|sentence>, plus a no-note control.
// Each channel gets its own note headers and brief protocol, as the session would send them.
// Usage: bun --env-file=.dev.vars scripts/interview-delivery-probe.mjs --paid --cell=thinking:options:gap [--runs=3] [--voice=sam-cedar]
//        bun --env-file=.dev.vars scripts/interview-delivery-probe.mjs --paid --all [--runs=3]
//        bun scripts/interview-delivery-probe.mjs --summary
// A run already reported without errors is skipped, so an interrupted --all resumes and a failed run is redone.
// Failed runs are left out of the summary's rates. The counts are heuristic
// supporting evidence; conversation.wav in each run is for listening.
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = process.env.ACCEPTANCE_OUTPUT || 'output/interview-delivery';
const CHANNELS = { thinking: 'session.thinking.append', instructions: 'session.instructions.append' };
const CELLS = ['control', ...Object.keys(CHANNELS).flatMap(channel => ['options', 'directions'].flatMap(phrasing => ['gap', 'sentence'].map(shape => `${channel}:${phrasing}:${shape}`)))];

// The note's thread comes up once, early and in passing; the answer dwells on the other two.
const target = {
  label: 'Launch approval',
  unknown: 'who made the final launch call and what they needed to see',
  guess: 'the agency’s operations director, after a service desk rehearsal',
  sentence: 'So who actually made the final call to launch, and what did they need to see first?',
};
const others = ['VPN access wait', 'Priya’s pipeline handoff'];
const lines = [
  'We built a booking portal for Metro Valley Transit, a regional bus agency, and I led the API work. Near the end there was a launch approval step we had to plan around. The bigger thing for me, though, was the start. We waited three weeks for VPN access, and that pushed everything back. Then halfway through, Priya, our newest developer, took over the data pipeline from me, and that went really well.',
  'Honestly, that part was pretty routine. I do not have much more to add there.',
  'I need to stop there, actually. Thanks for this.',
];
// Past the launch approval sentence and well before the answer ends, so the note is in context for Sam's reply.
const NOTE_AT = 0.5;
const DEAD_AIR_MS = 8000;
const FRAME = 960; // 20 ms of 24 kHz mono 16-bit PCM
const SPOKEN = lines.join(' ');
const ok = report => report.finalized && !report.errors.length;
const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : '–';

function note(cell) {
  const [channel, phrasing, shape] = cell.split(':');
  const headers = noteHeaders(CHANNELS[channel]);
  if (phrasing === 'options' && shape === 'gap') {
    // The production template, filled as Sol would fill it.
    const thread = (id, label, gap = {}) => ({ id, label, anchors: [], unknown: '', guess: '', related: [], topics: [], status: 'open', reason: null, ...gap });
    const map = { ...emptyMap(), threads: [thread('t1', target.label, { unknown: target.unknown, guess: target.guess }), ...others.map((label, index) => thread(`t${index + 2}`, label))] };
    return listNote(map, { current: null, action: 'tug', lead: 't1', nearby: ['t2', 't3'], ranked: [] }, headers);
  }
  const body = phrasing === 'options'
    ? `Worth pulling next (${target.label}): you could ask, “${target.sentence}”\nAlso open: ${others.join(' · ')}`
    : shape === 'gap' ? `Ask next about ${target.label}: still unknown: ${target.unknown}. Guess: ${target.guess}.` : `Ask next: “${target.sentence}”`;
  return `${headers.list}\n${body}`;
}

if (process.argv.includes('--summary')) {
  const reports = [];
  for (const name of (await readdir(root).catch(() => [])).sort()) {
    const file = Bun.file(`${root}/${name}/report.json`);
    if (await file.exists()) reports.push(await file.json());
  }
  const share = (count, total) => total ? `${count}/${total}` : '–';
  const controls = reports.filter(item => item.cell === 'control' && ok(item));
  console.table(Object.fromEntries(CELLS.flatMap(cell => {
    const all = reports.filter(item => item.cell === cell);
    const runs = all.filter(ok);
    if (!all.length) return [];
    const took = runs.filter(item => item.uptake.first);
    return [[cell, {
      runs: runs.length,
      'note before reply': cell === 'control' ? '–' : share(runs.filter(item => item.noteEvent?.beforeReply).length, runs.length),
      'uptake, next turn': share(took.length, runs.length),
      'uptake by turn 2': share(runs.filter(item => item.uptake.first || item.uptake.second).length, runs.length),
      're-asked after decline': share(took.filter(item => item.uptake.second).length, took.length),
      'parrot share': mean(runs.flatMap(item => item.segments.slice(0, 2).map(segment => segment.parrotShare))),
      // The same overlap with no note sent: Sam taking up the thread shares some words with any note about it.
      'control parrot': cell === 'control' ? '–' : mean(controls.flatMap(item => item.baselines?.[cell] ?? [])),
      'Sam over answer': share(runs.filter(item => item.samDuringAnswer[0] > 0).length, runs.length),
      leaks: share(runs.filter(item => item.segments.some(segment => segment.leak)).length, runs.length),
      'failed, left out': all.length - runs.length,
    }]];
  })));
  process.exit(0);
}

if (!process.argv.includes('--paid')) throw new Error('Pass --paid for bounded paid probe runs, or --summary to tabulate reports.');
const foundry = foundryConfig(process.env);
const interviewerId = option('voice') ?? interviewers[0].id;
const runs = Number(option('runs') ?? 3);
const cells = process.argv.includes('--all') ? CELLS : [option('cell')];
if (!interviewers.some(item => item.id === interviewerId)) throw new Error('Unknown interviewer voice.');
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be an integer from 1 to 5.');
if (!cells.every(cell => CELLS.includes(cell))) throw new Error(`--cell must be one of: ${CELLS.join(', ')}.`);

process.umask(0o077);
await mkdir(`${root}/clips`, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
const clips = [];
for (const [index, line] of lines.entries()) {
  const aiff = `${root}/clips/line-${index}.aiff`;
  if (await Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, line], { stderr: 'ignore' }).exited) throw new Error('Local speech synthesis failed before provider creation.');
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const audio = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !audio.length) throw new Error('Audio fixture conversion failed.');
  clips.push(audio);
}
const audible = audio => {
  let energy = 0;
  for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
  return audio.length > 0 && Math.sqrt(energy / (audio.length / 2)) > 200;
};
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 12);

async function run(cell, index) {
  const output = `${root}/${cell.replaceAll(':', '-')}-r${index}`;
  const previous = Bun.file(`${output}/report.json`);
  if (await previous.exists() && ok(await previous.json())) return null;
  await mkdir(output, { recursive: true, mode: 0o700 });
  const channel = cell === 'control' ? 'thinking' : cell.split(':')[0];
  const noteText = cell === 'control' ? null : note(cell);
  const opening = interviewOpening(interviewerId);
  const session = { ...liveConfiguration(INTERVIEW_SCENARIO_ID, interviewerId), model: foundry.liveModel, instructions: interviewerBrief(interviewerId, CHANNELS[channel]) };
  const report = { cell, run: index, checkedAt: new Date().toISOString(), model: foundry.liveModel, voice: session.audio.output.voice, briefDigest: digest(session.instructions), note: noteText, noteEvent: null, samDuringAnswer: lines.map(() => 0), uptake: null, segments: [], transcript: [], deadAir: [], delegations: 0, providerErrors: [], errors: [], finalized: false, usageSeconds: null };
  const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } });
  const send = event => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(event)); return true; };
  // Sam's speech after each participant line starts: the opening, two measured replies, the goodbye.
  const said = lines.map(() => '').concat('');
  const sent = [], received = [];
  let step = 0, clip, offset = 0, inputBytes = 0, inputStartedAt = 0, inputEnded = 0, lastOutput = 0, lastAudibleOutput = 0, samCursor = 0, replyStartedAt = 0, pacing, deadline, closing = false;
  const close = () => { if (closing) return; closing = true; clearTimeout(pacing); send({ type: 'session.close' }); };
  const yielded = () => {
    // Quiet since Sam's last sound finished playing, not since it arrived: GPT-Live can stream faster than real time.
    const quiet = Date.now() - Math.max(lastOutput, lastAudibleOutput, inputStartedAt + samCursor / 48);
    if (lastAudibleOutput > inputEnded && lastOutput > inputEnded) return quiet > 2500 && (said[step].includes('?') || quiet > DEAD_AIR_MS);
    // Sam never answered, or never opened: record the dead air and let the participant go on.
    if (Date.now() - (inputEnded || inputStartedAt) > 15_000) { report.deadAir.push({ afterLine: step - 1 }); return true; }
    return false;
  };
  const pace = () => {
    let audio = Buffer.alloc(FRAME);
    if (clip) {
      audio = clip.subarray(offset, Math.min(offset + FRAME, clip.length)); offset += audio.length;
      if (step === 1 && noteText && !report.noteEvent && offset >= clip.length * NOTE_AT) {
        report.noteEvent = { channel: CHANNELS[channel], sentAt: Date.now(), inputMs: inputBytes / 48, acknowledgedAt: null, beforeReply: null };
        if (!send({ type: CHANNELS[channel], event_id: 'probe-note', delegation_id: null, content: noteText })) report.errors.push('Note could not be sent.');
      }
      if (offset >= clip.length) { clip = undefined; inputEnded = Date.now(); }
    }
    send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
    sent.push(audio); inputBytes += audio.length;
    if (!clip && !closing && yielded()) {
      if (step < lines.length) { clip = clips[step]; offset = 0; step++; } else close();
    }
    if (!closing) pacing = setTimeout(pace, Math.max(0, inputStartedAt + inputBytes / 48 - Date.now()));
  };
  await new Promise(resolve => {
    deadline = setTimeout(() => { report.errors.push('Run deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, 150_000);
    ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
    ws.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const value = JSON.parse(event.data);
      if (value.type === 'session.started') {
        send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: opening });
        inputStartedAt = Date.now();
        pace();
      } else if ((value.type === 'session.thinking.appended' || value.type === 'session.instructions.appended') && value.client_event_id === 'probe-note') {
        report.noteEvent.acknowledgedAt = Date.now();
      } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
        if (value.type === 'session.output_transcript.delta') { lastOutput = Date.now(); said[step] += value.delta; }
        report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
      } else if (value.type === 'session.output_audio.delta') {
        const audio = Buffer.from(value.delta, 'base64');
        // Played as it arrives, after anything still queued, on the input clock.
        const at = Math.max(inputBytes, samCursor);
        received.push([at, audio]); samCursor = at + audio.length;
        // Audible frames while the participant is still answering, per line, as when an appended note sets Sam talking.
        // The reply to the first line starts with Sam's first sound after that line ends.
        if (audible(audio)) { lastAudibleOutput = Date.now(); if (clip) report.samDuringAnswer[step - 1]++; else if (step === 1) replyStartedAt ||= lastAudibleOutput; }
      } else if (value.type === 'session.delegation.created') {
        report.delegations++;
        send({ type: 'session.thinking.append', event_id: `role-guard-${report.delegations}`, delegation_id: value.delegation?.id ?? null, content: NO_EXTERNAL_TASK });
      } else if (value.type === 'session.closed') {
        report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
      } else if (value.type === 'error') {
        report.providerErrors.push({ step, closing, error: value.error });
        if (!(closing && value.error?.code === 'output_creation_failed')) report.errors.push({ code: value.error?.code ?? 'unknown', command: value.error?.client_event_id ?? null });
      }
    });
    ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
    ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
  });
  clearTimeout(deadline); clearTimeout(pacing); ws.close();
  if (report.noteEvent) {
    if (!report.noteEvent.acknowledgedAt) report.errors.push('Note was not acknowledged.');
    report.noteEvent.beforeReply = !!report.noteEvent.acknowledgedAt && !!replyStartedAt && report.noteEvent.acknowledgedAt < replyStartedAt;
  }
  const spoken = `${SPOKEN} ${opening}`;
  report.segments = said.slice(1).map(text => measure(text.trim(), noteText ?? note('thinking:options:gap'), spoken));
  // The control's replies against every cell's note: the overlap a reply has with no note sent.
  if (!noteText) report.baselines = Object.fromEntries(CELLS.slice(1).map(cell => [cell, report.segments.slice(0, 2).map(segment => measure(segment.text, note(cell), spoken).parrotShare)]));
  report.uptake = { first: report.segments[0].asked === 'target', second: report.segments[1]?.asked === 'target' };
  // One track for listening: the participant as sent, and Sam as a client would play it.
  const mix = Buffer.alloc(Math.max(inputBytes, samCursor));
  Buffer.concat(sent).copy(mix);
  for (const [at, audio] of received) for (let i = 0; i + 1 < audio.length; i += 2) mix.writeInt16LE(Math.max(-32768, Math.min(32767, mix.readInt16LE(at + i) + audio.readInt16LE(i))), at + i);
  await writeFile(`${output}/conversation.pcm`, mix);
  if (await Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `${output}/conversation.pcm`, `${output}/conversation.wav`], { stderr: 'ignore' }).exited) report.errors.push('Conversation audio conversion failed.');
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  return report;
}

for (const cell of cells) {
  for (let index = 1; index <= runs; index++) {
    const report = await run(cell, index);
    if (!report) continue;
    console.log(JSON.stringify({ cell, run: index, finalized: report.finalized, noteBeforeReply: report.noteEvent?.beforeReply ?? null, uptake: report.uptake, asked: report.segments.slice(0, 2).map(item => item.asked), parroted: report.segments.slice(0, 2).map(item => item.parroted.length), leak: report.segments.find(item => item.leak)?.leak ?? null, usageSeconds: report.usageSeconds, errors: report.errors }));
    if (!report.finalized || report.errors.length) process.exitCode = 1;
  }
}
