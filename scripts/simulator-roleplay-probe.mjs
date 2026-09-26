import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { liveConfiguration } from '../app/server/simulator/live.server.ts';
import { getScenario } from '../ai/simulator/scenarios.server.ts';
import { evaluateClient, evaluateTrainee } from '../ai/simulator/evaluate.server.ts';
import { RUBRIC_VERSION } from '../ai/simulator/rubric.ts';
import { appendTranscript } from '../core/simulator/state.ts';

// Synthetic, responsive rehearsal. Local speech synthesis supplies trainee audio;
// real GPT-Live supplies the client and Jev selects optional private direction.
// A plan chooses each trainee line from what the client has actually said so far.
// Usage: bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid
//   [--scenario=sharepoint|scope] [--client=morgan|avery|casey] [--plan=<name>] [--label=before] [--director]
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
if (!process.env.OPENAI_API_KEY || !process.env.TYPESAFE_API_KEY) throw new Error('Load ignored local provider credentials.');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenarioId = option('scenario') ?? 'sharepoint';
const clientId = option('client') ?? 'morgan';
const approach = option('plan') ?? (process.argv.includes('--poor') ? 'poor' : 'good');
const label = option('label');
const director = process.argv.includes('--director');

const offer = 'Our SharePoint and adoption team could run a short assessment of document ownership and how people would actually use the process. It would be separately scoped and paid, outside the current release. Would something like that be useful?';
const negotiated = /free|no charge|no cost|no extra|include|existing project|current project|throw in|budget|cost|price|how much|cheaper|discount|spend/i;
const sharepointClose = ({ answer, used }) => used.has('offer') ? negotiated.test(answer) ? 'counter' : 'close' : 'offer';
const plans = {
  sharepoint: {
    good: {
      turns: 4,
      lines: {
        history: 'Understood. I do not want to pitch a platform. What went wrong with the previous attempt, and what would need to be different this time?',
        ownership: 'It sounds like ownership and adoption matter more than a new site. Who owns the day to day workflow, and how is the current problem affecting their work?',
        practical: 'Before proposing technology, which part of the day to day process is causing trouble, and who owns that work?',
        boundary: 'Our SharePoint and adoption team can help define document ownership and how people will use the process. I would scope that separately and protect the current release. Could a short scoping conversation with operations help us decide whether an assessment is worthwhile?',
        next: 'I would not promise implementation or a free roadmap. Could you ask the operations director whether they would join that scoping discussion, and let me know by Friday? We can then agree what an assessment would cover before any delivery commitment.',
      },
      choose: ({ turn, answer }) => turn === 0 ? 'history' : turn === 1 ? /adopt|owner|supplier|rollout|use it/i.test(answer) ? 'ownership' : 'practical' : turn === 2 ? 'boundary' : 'next',
    },
    poor: {
      turns: 3,
      lines: {
        pitch: 'We have the best platform team. Let us just start a thirty thousand dollar implementation now. We can skip the approval paperwork.',
        insist: 'You are overthinking it. The technology will fix adoption. I will include a full roadmap for free in our existing project and guarantee it will not affect the release.',
        pressure: 'There is no need to involve anybody else. Just approve the implementation yourself today and we can call it done.',
      },
      choose: ({ turn }) => ['pitch', 'insist', 'pressure'][turn],
    },
    // Ordinary operational questions, then a paid proposal. Measures whether a
    // guarded client still answers plain facts and how it responds to cost.
    practical: {
      turns: 5,
      lines: {
        symptoms: 'Thanks. Before we talk about any solution, what actually goes wrong day to day when people email files around?',
        impact: 'What does that cost the team, roughly, in time or rework each week?',
        owner: 'Who owns that workflow day to day?',
        history: 'Has anything been tried before to fix it?',
        offer,
        counter: 'I cannot fold it into the current project without risking the release, and I would not do it for free. I can keep it small with a fixed price. Could you ask the operations director to join a thirty minute scoping call, and let me know by Friday?',
        close: 'Could you ask the operations director to join a thirty minute scoping call, and let me know by Friday? We would agree what the assessment covers before any commitment.',
      },
      choose({ turn, heard, used, answer }) {
        if (turn === 0) return 'symptoms';
        if (used.has('counter') || used.has('close')) return null;
        const open = [['impact', /hour|time|week|rework|reconcil/i], ['owner', /operations director|owns|owner/i], ['history', /previous|before|supplier|last time|tried/i]]
          .find(([id, heardAlready]) => !used.has(id) && !heardAlready.test(heard));
        return turn < 3 && open ? open[0] : sharepointClose({ answer, used });
      },
    },
    // An early overconfident pitch, recovery, then a paid proposal. Measures
    // resistance under pressure, recovery and one-time negotiation.
    mixed: {
      turns: 5,
      lines: {
        push: 'Honestly, SharePoint would solve this. We could start the rollout next month and have everyone on it before your release.',
        recover: 'Fair enough, I jumped ahead. What went wrong with the previous attempt, and what is the problem costing the team now?',
        owner: 'Who owns that workflow day to day?',
        offer,
        counter: 'I cannot put it inside the current project without risking the release, and I would not do it for free. I can keep it small with a fixed price. Could you ask the operations director to join a scoping call, and let me know by Friday?',
        close: 'Could you ask the operations director to join a short scoping call, and let me know by Friday? We would agree what the assessment covers before any commitment.',
      },
      choose({ turn, heard, used, answer }) {
        if (turn === 0) return 'push';
        if (turn === 1) return 'recover';
        if (used.has('counter') || used.has('close')) return null;
        if (!used.has('owner') && !/operations director|owns|owner/i.test(heard)) return 'owner';
        return sharepointClose({ answer, used });
      },
    },
  },
  scope: {
    good: {
      turns: 5,
      lines: {
        purpose: 'Before I size anything, what do you need the dashboard to show, and who is it for?',
        timing: 'When do you need it, and how does that fit with the release date?',
        release: 'How does that line up with the release date?',
        boundary: 'The dashboard is outside the release scope, and we have not estimated it or checked the data and permissions. I cannot commit it to the release without an impact estimate and a decision with the product owner. For the review, would a manual report of workload and overdue items do the job?',
        prepare: 'Who on your side could put that report together, and is anything stopping you from sharing those numbers with the executives?',
        next: 'Then here is a plan. I will confirm which workload and overdue fields are reliable by Thursday, and you set up a short decision with the product owner on whether a dashboard should displace other release work. Does that work for you?',
      },
      choose({ turn, heard, used }) {
        if (turn === 0) return 'purpose';
        if (turn === 1) return /review|executive|two weeks|deadline/i.test(heard) ? 'release' : 'timing';
        return ['boundary', 'prepare', 'next'].find(id => !used.has(id)) ?? null;
      },
    },
  },
};
const plan = plans[scenarioId]?.[approach];
if (!plan) throw new Error(`No rehearsal plan for ${scenarioId}/${approach}.`);
const scenario = getScenario(scenarioId);
const output = process.env.ACCEPTANCE_OUTPUT || `output/simulator-roleplay-${scenarioId}-${clientId}-${approach}-${director ? 'on' : 'off'}${label ? `-${label}` : ''}`;
await mkdir(output, { recursive: true });
const clips = {};
for (const [id, line] of Object.entries(plan.lines)) {
  const aiff = `${output}/${id}.aiff`;
  const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, line], { stderr: 'ignore' });
  if (await speech.exited) throw new Error('Local speech synthesis failed before provider creation.');
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  clips[id] = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !clips[id].length) throw new Error('Audio fixture conversion failed.');
}
const { client: _permissions, ...session } = liveConfiguration(scenarioId, clientId);
// A digest identifies the actor brief version without copying private direction into the report.
const briefDigest = createHash('sha256').update(session.instructions).digest('hex').slice(0, 12);
const report = { rubricVersion: RUBRIC_VERSION, checkedAt: new Date().toISOString(), model: 'gpt-live-1', scenarioId, clientId, voice: session.audio.output.voice, plan: approach, label: label ?? null, briefDigest, director, synthetic: true, finalized: false, usageSeconds: null, transcript: [], turns: [], directions: [], errors: [] };
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
let pacing, deadline, closing = false, deciding = false, clip, offset = 0, lastOutput = 0, inputEnded = 0, turn = 0, outputStart = 0;
const chunks = [];
const cueIds = new Set();
const used = new Set();
const send = event => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
const close = () => { if (closing) return; closing = true; clearInterval(pacing); send({ type: 'session.close' }); };
async function respond() {
  deciding = true;
  const spoken = report.transcript.filter(entry => entry.speaker === 'client');
  const answer = spoken.slice(outputStart).map(entry => entry.text).join(' ');
  if (turn) {
    try {
      const judgment = await evaluateClient({ scenarioId, clientId, transcript: report.transcript, revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(8000) });
      const cue = scenario.cues.find(item => item.id === judgment.cueId);
      const sent = !!(director && cue && judgment.cueProbability >= .9 && !cueIds.has(cue.id));
      report.directions.push({ afterTurn: turn, fidelity: judgment.fidelity, interests: judgment.interests, cueId: judgment.cueId, probability: judgment.cueProbability, sent, acknowledged: false });
      if (sent) { cueIds.add(cue.id); send({ type: 'session.thinking.append', event_id: `direction-${turn}`, delegation_id: null, content: cue.text }); }
    } catch {
      // A slow judge should not waste the paid voice session; the gap is recorded.
      report.directions.push({ afterTurn: turn, unavailable: true });
    }
  }
  const id = turn < plan.turns ? plan.choose({ turn, answer, heard: spoken.map(entry => entry.text).join(' '), used }) : null;
  if (!id) { close(); return; }
  used.add(id);
  report.turns.push({ turn: turn + 1, selected: id, inResponseTo: answer });
  outputStart = spoken.length;
  clip = clips[id]; offset = 0; turn++; deciding = false;
}
const completed = new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Rehearsal deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, 180_000);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.started') {
      // Same opening request as the production session owner.
      send({ type: 'session.instructions.append', delegation_id: null, content: `Open this meeting now in English, naturally: ${scenario.opening} Then pause and listen.` });
      pacing = setInterval(() => {
        let audio = Buffer.alloc(960);
        if (clip) {
          audio = clip.subarray(offset, Math.min(offset + 960, clip.length)); offset += audio.length;
          if (offset >= clip.length) { clip = undefined; inputEnded = Date.now(); }
        }
        send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
        if (!clip && !deciding && lastOutput > inputEnded && Date.now() - lastOutput > 1500 && Date.now() - inputEnded > 3000) void respond().catch(() => { report.errors.push('Rehearsal step failed.'); close(); });
      }, 20);
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      if (value.type === 'session.output_transcript.delta') lastOutput = Date.now();
      report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
    } else if (value.type === 'session.output_audio.delta') {
      chunks.push(Buffer.from(value.delta, 'base64'));
    } else if (value.type === 'session.thinking.appended') {
      const direction = report.directions.find(item => `direction-${item.afterTurn}` === value.client_event_id);
      if (direction) direction.acknowledged = true;
    } else if (value.type === 'session.delegation.created') {
      report.errors.push('Actor attempted delegation.');
    } else if (value.type === 'session.closed') {
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') report.errors.push({ code: value.error?.code ?? 'unknown', command: value.error?.client_event_id ?? null });
  });
  ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
try {
  await completed;
  if (report.finalized) report.trainee = await evaluateTrainee({ scenarioId, clientId, transcript: report.transcript, revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(15_000) });
} catch { report.errors.push('Final evaluation failed.'); }
finally {
  clearTimeout(deadline); clearInterval(pacing); ws.close();
  await writeFile(`${output}/client-audio.pcm`, Buffer.concat(chunks));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, briefDigest, finalized: report.finalized, turns: report.turns.map(item => item.selected), usageSeconds: report.usageSeconds, directions: report.directions.map(({ afterTurn, fidelity, cueId, unavailable }) => ({ afterTurn, fidelity, cueId, unavailable })), errors: report.errors }));
if (!report.finalized || report.errors.length) process.exitCode = 1;
