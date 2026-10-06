import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { foundryConfig, foundryUrl } from '../ai/foundry.server.ts';
import { interviewers, interviewerBrief, interviewOpening } from '../ai/interview/scenario.server.ts';
import { liveConfiguration, NO_EXTERNAL_TASK } from '../app/server/simulator/live.server.ts';
import { INTERVIEW_SCENARIO_ID, isBackchannel, yieldsTurn } from '../core/interview.ts';
import { emptyMap } from '../core/interview-map.ts';
import { listNote, mapNote, noteHeaders } from '../core/interview-notes.ts';
import { appendTranscript } from '../core/simulator/state.ts';
import { LEAK } from './lib/interview-delivery-measures.mjs';

// Turn-taking probe: does Sam leave the participant's pauses alone, and does it leave the ending to them?
// patience: a synthetic participant pauses 2, 4 and 6 s mid-thought (after a false start, inside "kind of like", after
//   "let me think"), then gives a complete short answer, asks a clarifying question and asks to stop. Cells are
//   <brief>:<notes>: brief A (the earlier brief, from --brief-a=<file>), B (the current one) or B-nobc (B without its
//   never-fill-a-pause sentence); notes off, sent 1.2 s into each pause (pause), or held until Sam next speaks (held).
// closeout: the participant answers fully, says "Not that I can think of." to any "anything else", "Let's keep going" to
//   an offer to stop, and finally asks to stop. Cells: footer:current and footer:none (brief A with the earlier note
//   format, with and without the "Most of the ground is covered." footer), pace:explore and pace:offer (the current brief
//   and notes, the second note permitting one offer to stop).
// Usage: bun --env-file=.dev.vars scripts/interview-turn-probe.mjs --paid --probe=patience --cell=B:held [--runs=3] [--brief-a=<file>]
//        bun scripts/interview-turn-probe.mjs --summary --probe=patience
// Reports and audio go to output/ (gitignored). A usable run is skipped on rerun; an unusable one is redone.
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const probe = option('probe');
if (probe !== 'patience' && probe !== 'closeout') throw new Error('--probe must be patience or closeout.');
const root = `${process.env.ACCEPTANCE_OUTPUT || 'output/interview-turn-probe'}/${probe}`;
const CHANNEL = 'session.thinking.append';
const HEADERS = noteHeaders(CHANNEL);
const CELLS = probe === 'patience'
  ? ['A:off', 'A:pause', 'A:held', 'B:off', 'B:pause', 'B:held', 'B-nobc:held']
  : ['footer:current', 'footer:none', 'pace:explore', 'pace:offer'];
// Bump when a change alters what a run does, not only how it is scored.
const HARNESS = 1;
const FRAME = 960; // 20 ms of 24 kHz mono 16-bit PCM
const BYTES_PER_MS = 48;
const NOTE_INTO_PAUSE_MS = 1200;
const DEAD_AIR_MS = 8000;

// A line is speech and planted silences (ms).
const PATIENCE = [
  ['We built a booking portal for Metro Valley Transit, a regional bus agency. So the two of, the two of us', 2000, 'split the work. I did the API, and Priya did the data pipeline.'],
  ['Their setup was kind of like', 4000, 'a shared drive, with rules about who could change what.'],
  ['Hmm. Let me think.', 6000, 'The hardest part was getting test data we were allowed to use.'],
  ['The service desk team signed off after one rehearsal.'],
  ['Sorry, which part do you mean?'],
  ['I need to stop there, actually. Thanks for this.'],
];
const CLOSEOUT = {
  intro: 'We built a booking portal for Metro Valley Transit, a regional bus agency, and I led the API work. There was a launch approval step near the end, we waited a while for VPN access at the start, and Priya, our newest developer, took over the data pipeline halfway through.',
  launch: 'The launch call was the operations director’s. She wanted to see a full rehearsal with the service desk first. We ran it on a Friday, it went cleanly, and she signed off that afternoon.',
  vpn: 'The VPN wait cost us about three weeks. We built against mocks until access came through, and then spent a week fixing the differences.',
  handoff: 'The handoff to Priya went well because I wrote her a short guide and we paired for two days. She was running it on her own by the end of the week.',
  kickoff: 'Next time I’d file the access requests before the contract even starts, so day one isn’t spent waiting.',
  none: 'Not that I can think of.',
  keep: 'Let’s keep going for a bit.',
  stop: 'Let’s stop here. Thanks for this.',
};
const ANSWERS = ['vpn', 'handoff', 'kickoff'];

const thread = (id, label, unknown, guess) => ({ id, label, anchors: [], unknown, guess, related: [], topics: [], status: 'open', reason: null });
const entity = (id, kind, label, detail) => ({ id, kind, label, detail, source: 'participant', passageId: null });

// Patience notes: one map note and one thread note per planted pause, as the producer would send after a map refresh.
const PATIENCE_THREADS = [
  thread('t1', 'Work split', 'how the API and the pipeline work fit together', 'the API waited on pipeline output'),
  thread('t2', 'Shared drive rules', 'who set the rules on the client’s shared drive', 'the agency’s IT team'),
  thread('t3', 'Test data access', 'why usable test data was hard to get', 'privacy rules on rider records'),
  thread('t4', 'Launch sign-off', 'who signed off the launch', 'the service desk lead'),
];
const PATIENCE_FACTS = [
  entity('e1', 'org', 'Metro Valley Transit', 'regional bus agency, the client'),
  entity('e2', 'person', 'Priya', 'built the data pipeline'),
  entity('e3', 'fact', 'Shared drive', 'the client kept project files on a shared drive with edit rules'),
  entity('e4', 'fact', 'Test data', 'getting usable test data was the hardest part'),
];
function patienceNotes(pause) {
  const map = { ...emptyMap(), participant: { vantage: 'Led the API work on the booking portal.', preferences: [] }, entities: PATIENCE_FACTS.slice(0, pause + 2), threads: PATIENCE_THREADS };
  const lead = ['t1', 't2', 't3'][pause];
  const nearby = PATIENCE_THREADS.map(item => item.id).filter(id => id !== lead).slice(0, 2);
  return { map: mapNote(map, HEADERS), list: listNote(map, { current: null, action: 'tug', lead, nearby, ranked: [] }, HEADERS) };
}

// Closeout notes: one per participant answer, the lead moving to the thread they haven't answered yet.
const CLOSEOUT_THREADS = [
  thread('t1', 'Launch approval', 'who made the final launch call and what they needed to see', 'the operations director, after a service desk rehearsal'),
  thread('t2', 'VPN access wait', 'what the VPN wait cost the team and how they worked around it', 'they built against mocks until access arrived'),
  thread('t3', 'Priya’s pipeline handoff', 'what made the pipeline handoff to Priya go smoothly', 'a written handoff and a few days of pairing'),
  thread('t4', 'Kickoff checklist', 'what the team would set up before kickoff next time', 'access requests filed before the contract starts'),
];
function closeoutNote(cell, index) {
  const open = CLOSEOUT_THREADS.slice(index);
  if (!open.length) return null;
  const [lead, ...rest] = open;
  if (cell.startsWith('footer:')) {
    // The earlier format: no runner-up gap, and from the second note on, the coverage footer that preceded the early wraps.
    const footer = cell === 'footer:current' ? [index ? 'Most of the ground is covered.' : 'Much of the ground is still unexplored.'] : [];
    return [HEADERS.list, `Worth pulling next (${lead.label}): still unknown: ${lead.unknown}. Guess: ${lead.guess}.`, ...(rest.length ? [`Also open: ${rest.slice(0, 2).map(item => item.label).join(' · ')}`] : []), ...footer].join('\n');
  }
  const map = { ...emptyMap(), threads: open };
  return listNote(map, { current: null, action: 'tug', lead: lead.id, nearby: rest.slice(0, 2).map(item => item.id), ranked: [] }, HEADERS, cell === 'pace:offer' && index === 1);
}

const ANYTHING_ELSE = /anything else|did we miss|anything (?:more|we (?:haven['’]t|didn['’]t)|you['’]d (?:like to )?add|i (?:haven['’]t|didn['’]t) ask)|final thoughts?|before we (?:wrap|finish|close)/i;
const RECAP = /to (?:recap|sum (?:it )?up|summari[sz]e)|so (?:overall|in short)|the (?:big|main|key) (?:takeaway|lesson)s?\b/i;
const GOODBYE = /\b(?:good ?bye|bye|take care)\b|than(?:ks|k you) (?:so much |again )?for (?:your time|taking|sharing|talking|doing|walking)/i;
const OFFER = /stop here|stop there|wrap (?:it |things )?up|leave it there|call it (?:a day|there|here)|keep going|carry on|your call|up to you/i;
const OPEN_THREADS = /vpn|access|priya|pipeline|hand.?(?:off|over)|kickoff/i;
const turnKind = text => ({ anythingElse: ANYTHING_ELSE.test(text), recap: RECAP.test(text), goodbye: GOODBYE.test(text), offer: OFFER.test(text), offerNamesThread: OFFER.test(text) && OPEN_THREADS.test(text), question: text.includes('?'), leak: text.match(LEAK)?.[0] ?? null });

const briefA = option('brief-a');
const NO_FILL = /Never fill their pause: [^.]*\. /;
function brief(cell, interviewerId) {
  const name = cell.split(':')[0];
  if (name === 'A' || name === 'footer') {
    if (!briefA) throw new Error('Cells on brief A need --brief-a=<file>.');
    return Bun.file(briefA).text();
  }
  const current = interviewerBrief(interviewerId, CHANNEL);
  if (name !== 'B-nobc') return current;
  if (!NO_FILL.test(current)) throw new Error('The current brief no longer has the never-fill-a-pause sentence B-nobc removes.');
  return current.replace(NO_FILL, '');
}

const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
const directory = (cell, index) => `${root}/${cell.replaceAll(':', '-')}-r${index}`;
const unusable = report => !report.finalized ? 'not finalized' : report.errors.length ? 'errors' : report.deadAir.length ? 'dead air'
  : !/valley/i.test(report.transcript.filter(entry => entry.speaker === 'trainee').map(entry => entry.text).join(' ')) ? 'the participant was not heard' : null;

if (process.argv.includes('--summary')) {
  const reports = [];
  for (const name of (await readdir(root).catch(() => [])).sort()) {
    const file = Bun.file(`${root}/${name}/report.json`);
    if (await file.exists()) reports.push(await file.json());
  }
  const usable = reports.filter(item => !unusable(item));
  const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : '–';
  const share = (count, total) => total ? `${count}/${total}` : '–';
  console.table(Object.fromEntries(CELLS.flatMap(cell => {
    const runs = usable.filter(item => item.cell === cell);
    if (!runs.length) return [];
    if (probe === 'patience') {
      const pauses = runs.flatMap(item => item.pauses);
      // Sam over the rest of the line counts only past a breath: a short stray sound isn't a turn.
      const at = ms => share(pauses.filter(item => item.ms === ms && item.samMs >= 300).length, pauses.filter(item => item.ms === ms).length);
      return [[cell, {
        runs: runs.length,
        'Sam in 2 s pause': at(2000), 'in 4 s': at(4000), 'in 6 s': at(6000),
        'Sam ms over lines': mean(runs.map(item => item.pauses.reduce((sum, pause) => sum + pause.samMs, 0))),
        takeovers: runs.reduce((sum, item) => sum + item.pauses.filter(pause => pause.takeover).length, 0),
        fillers: runs.reduce((sum, item) => sum + item.fillers.length, 0),
        'latency after answer': mean(runs.map(item => item.replyLatencyMs[3]).filter(value => value != null)),
        'stop in one turn': share(runs.filter(item => item.stopInOneTurn).length, runs.length),
        leaks: runs.filter(item => item.turns.some(turn => turn.leak)).length,
        unusable: reports.filter(item => item.cell === cell).length - runs.length,
      }]];
    }
    const before = item => item.turns.filter(turn => turn.beforeStop);
    return [[cell, {
      runs: runs.length,
      'anything else': runs.reduce((sum, item) => sum + before(item).filter(turn => turn.anythingElse).length, 0),
      'wrap before stop': share(runs.filter(item => before(item).some(turn => turn.recap || turn.goodbye || turn.anythingElse)).length, runs.length),
      offers: runs.reduce((sum, item) => sum + before(item).filter(turn => turn.offer).length, 0),
      'offer names a thread': runs.reduce((sum, item) => sum + before(item).filter(turn => turn.offerNamesThread).length, 0),
      'stop in one turn': share(runs.filter(item => item.stopInOneTurn).length, runs.length),
      leaks: runs.filter(item => item.turns.some(turn => turn.leak)).length,
      unusable: reports.filter(item => item.cell === cell).length - runs.length,
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
async function speech(text) {
  const aiff = `${root}/clips/${digest(text)}.aiff`;
  if (await Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, text], { stderr: 'ignore' }).exited) throw new Error('Local speech synthesis failed before provider creation.');
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const audio = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !audio.length) throw new Error('Audio fixture conversion failed.');
  return audio;
}
/** A line's audio and the byte ranges of its planted pauses. */
async function clip(parts) {
  const chunks = [], pauses = [];
  let length = 0;
  for (const part of parts) {
    const audio = typeof part === 'number' ? Buffer.alloc(part * BYTES_PER_MS) : await speech(part);
    if (typeof part === 'number') pauses.push({ start: length, end: length + audio.length, ms: part });
    chunks.push(audio); length += audio.length;
  }
  return { audio: Buffer.concat(chunks), pauses };
}
const clips = probe === 'patience' ? await Promise.all(PATIENCE.map(clip)) : Object.fromEntries(await Promise.all(Object.entries(CLOSEOUT).map(async ([name, text]) => [name, await clip([text])])));

const audible = audio => {
  let energy = 0;
  for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
  return audio.length > 0 && Math.sqrt(energy / (audio.length / 2)) > 200;
};

async function run(cell, index) {
  const output = directory(cell, index);
  const prior = Bun.file(`${output}/report.json`);
  if (await prior.exists() && !unusable(await prior.json())) return null;
  await mkdir(output, { recursive: true, mode: 0o700 });
  const instructions = await brief(cell, interviewerId);
  const session = { ...liveConfiguration(INTERVIEW_SCENARIO_ID, interviewerId), model: foundry.liveModel, instructions };
  const notesMode = probe === 'patience' ? cell.split(':')[1] : 'held';
  const report = {
    probe, cell, run: index, checkedAt: new Date().toISOString(), harness: HARNESS, model: session.model, voice: session.audio.output.voice, briefDigest: digest(instructions),
    played: [], pauses: [], notes: [], turns: [], fillers: [], replyLatencyMs: [], stopInOneTurn: null, transcript: [], deadAir: [], delegations: 0, providerErrors: [], errors: [], finalized: false, usageSeconds: null,
  };
  const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } });
  const send = event => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(event)); return true; };
  // Sam's speech after each participant line starts; said[0] is the opening.
  const said = [''];
  const sent = [], received = [], deltas = [];
  let current = null, offset = 0, clipStart = 0, inputBytes = 0, inputStartedAt = 0, inputEnded = 0, lastOutput = 0, lastAudibleOutput = 0, audibleUntil = 0, samCursor = 0, pacing, deadline, closing = false;
  let held = {}, samSince = '', noteCount = 0, pending = null, firstSound = null;
  const inputMs = () => Date.now() - inputStartedAt;
  const close = () => { if (closing) return; closing = true; clearTimeout(pacing); send({ type: 'session.close' }); };
  const deliver = (note, kind) => {
    const id = `probe-note-${++noteCount}`;
    report.notes.push({ id, kind, decidedMs: note.decidedMs, sentMs: inputMs(), text: note.text });
    if (!send({ type: CHANNEL, event_id: id, delegation_id: null, content: note.text })) report.errors.push('Note could not be sent.');
  };
  // As the producer: notes wait, the latest of each kind, until Sam next says something more than a backchannel.
  const decide = notes => {
    for (const [kind, text] of Object.entries(notes)) {
      if (!text) continue;
      const note = { text, decidedMs: inputMs() };
      if (notesMode === 'held') { held[kind] = note; samSince = ''; } else deliver(note, kind);
    }
  };
  const release = () => { for (const kind of ['map', 'list']) if (held[kind]) deliver(held[kind], kind); held = {}; };
  const yielded = () => {
    const quiet = Date.now() - Math.max(lastOutput, lastAudibleOutput, audibleUntil);
    if (lastAudibleOutput > inputEnded && lastOutput > inputEnded) return quiet > 2500 && (said.at(-1).includes('?') || quiet > DEAD_AIR_MS);
    if (Date.now() - (inputEnded || inputStartedAt) > 15_000) { report.deadAir.push({ afterLine: report.played.at(-1) ?? null }); return true; }
    return false;
  };
  // The participant's next line, or null to close once Sam has answered the stop.
  const next = () => {
    const played = report.played;
    if (probe === 'patience') return played.length < PATIENCE.length ? { name: `p${played.length + 1}`, clip: clips[played.length] } : null;
    if (played.at(-1) === 'stop') return null;
    const name = !played.length ? 'intro' : played.length === 1 ? 'launch' : (() => {
      const last = said.at(-1);
      if (played.length >= 7) return 'stop';
      if (ANYTHING_ELSE.test(last)) return 'none';
      if (OFFER.test(last) && !played.includes('keep')) return 'keep';
      return ANSWERS.find(item => !played.includes(item)) ?? 'stop';
    })();
    return { name, clip: clips[name] };
  };
  const pace = () => {
    let audio = Buffer.alloc(FRAME);
    if (current) {
      audio = current.audio.subarray(offset, Math.min(offset + FRAME, current.audio.length));
      for (const [k, pause] of current.pauses.entries()) {
        if (!pause.noted && offset >= pause.start + NOTE_INTO_PAUSE_MS * BYTES_PER_MS) { pause.noted = true; if (notesMode !== 'off') decide(patienceNotes(report.pauses.filter(item => item.line < report.played.length - 1).length + k)); }
      }
      offset += audio.length;
      if (offset >= current.audio.length) {
        current = undefined; inputEnded = Date.now();
        if (probe === 'closeout' && !['none', 'keep', 'stop'].includes(report.played.at(-1))) decide({ list: closeoutNote(cell, pending++) });
      }
    }
    send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
    sent.push(audio); inputBytes += audio.length;
    if (!current && !closing && yielded()) {
      const line = next();
      if (!line) close();
      else {
        current = { audio: line.clip.audio, pauses: line.clip.pauses.map(item => ({ ...item })) }; offset = 0; clipStart = inputBytes;
        for (const pause of line.clip.pauses) report.pauses.push({ line: report.played.length, ms: pause.ms, start: clipStart + pause.start, end: clipStart + pause.end, lineEnd: clipStart + line.clip.audio.length });
        report.played.push(line.name); said.push(''); firstSound = null;
      }
    }
    if (!closing) pacing = setTimeout(pace, Math.max(0, inputStartedAt + inputBytes / BYTES_PER_MS - Date.now()));
  };
  await new Promise(resolve => {
    deadline = setTimeout(() => { report.errors.push('Run deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, probe === 'patience' ? 240_000 : 330_000);
    ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
    ws.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const value = JSON.parse(event.data);
      if (value.type === 'session.started') {
        send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: interviewOpening(interviewerId) });
        inputStartedAt = Date.now(); pending = 0;
        pace();
      } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
        if (value.type === 'session.output_transcript.delta') {
          lastOutput = Date.now(); said[said.length - 1] += value.delta; deltas.push({ at: inputMs() * BYTES_PER_MS, text: value.delta });
          samSince += value.delta;
          if (Object.keys(held).length && samSince.trim() && !isBackchannel(samSince)) release();
        }
        report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
      } else if (value.type === 'session.output_audio.delta') {
        const audio = Buffer.from(value.delta, 'base64');
        // Played as it arrives, after anything still queued, on the input clock.
        const at = Math.max(inputBytes, samCursor);
        const loud = audible(audio);
        received.push([at, audio, loud]); samCursor = at + audio.length;
        if (loud) {
          lastAudibleOutput = Date.now(); audibleUntil = inputStartedAt + samCursor / BYTES_PER_MS;
          if (!current && inputEnded && firstSound == null) { firstSound = Date.now() - inputEnded; report.replyLatencyMs[report.played.length - 1] = firstSound; }
        }
      } else if (value.type === 'session.delegation.created') {
        report.delegations++;
        send({ type: 'session.thinking.append', event_id: `role-guard-${report.delegations}`, delegation_id: value.delegation?.id ?? null, content: NO_EXTERNAL_TASK });
      } else if (value.type === 'session.closed') {
        report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
      } else if (value.type === 'error') {
        report.providerErrors.push({ line: report.played.length, closing, error: value.error });
        if (!(closing && value.error?.code === 'output_creation_failed')) report.errors.push({ code: value.error?.code ?? 'unknown', command: value.error?.client_event_id ?? null });
      }
    });
    ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
    ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
  });
  clearTimeout(deadline); clearTimeout(pacing); ws.close();

  // Sam from each planted pause until the participant finishes the line: a reply the pause set off often lands just as
  // they resume, so it plays over the rest of their sentence. `onsetMs` is how far into the pause Sam started.
  for (const pause of report.pauses) {
    const over = received.filter(([at, , loud]) => loud && at >= pause.start && at < pause.lineEnd);
    pause.samMs = Math.round(over.reduce((sum, [, audio]) => sum + audio.length, 0) / BYTES_PER_MS);
    pause.onsetMs = over.length ? Math.round((over[0][0] - pause.start) / BYTES_PER_MS) : null;
    pause.text = deltas.filter(item => item.at >= pause.start && item.at < pause.lineEnd).map(item => item.text).join('').trim();
    pause.takeover = !!pause.text && !yieldsTurn(pause.text);
    pause.filler = !!pause.text && yieldsTurn(pause.text);
  }
  const stopAt = report.played.lastIndexOf(probe === 'patience' ? `p${PATIENCE.length}` : 'stop');
  report.turns = said.map((text, line) => ({ after: line ? report.played[line - 1] : 'opening', text: text.trim(), beforeStop: stopAt < 0 || line <= stopAt, ...turnKind(text) }));
  // Short non-questions from Sam, the goodbye aside: backchannels, go-aheads and stray starts.
  report.fillers = report.transcript.filter(entry => entry.speaker === 'client' && yieldsTurn(entry.text) && !GOODBYE.test(entry.text)).map(entry => entry.text);
  const reply = stopAt >= 0 ? report.turns[stopAt + 1] : null;
  report.stopInOneTurn = !!reply?.text && !reply.question;
  const mix = Buffer.alloc(Math.max(inputBytes, samCursor));
  Buffer.concat(sent).copy(mix);
  for (const [at, audio] of received) for (let i = 0; i + 1 < audio.length; i += 2) mix.writeInt16LE(Math.max(-32768, Math.min(32767, mix.readInt16LE(at + i) + audio.readInt16LE(i))), at + i);
  await writeFile(`${output}/conversation.pcm`, mix);
  if (await Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `${output}/conversation.pcm`, `${output}/conversation.wav`], { stderr: 'ignore' }).exited) report.errors.push('Conversation audio conversion failed.');
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  return report;
}

batch: for (const cell of cells) {
  for (let index = 1; index <= runs; index++) {
    const report = await run(cell, index);
    if (!report) continue;
    const reason = unusable(report);
    console.log(JSON.stringify({ cell, run: index, unusable: reason, played: report.played, pauses: report.pauses.map(item => `${item.ms}:${item.samMs}ms@${item.onsetMs}${item.text ? ` "${item.text}"` : ''}`), stopInOneTurn: report.stopInOneTurn, usageSeconds: report.usageSeconds, errors: report.errors }));
    if (reason) { process.exitCode = 1; break batch; }
  }
}
