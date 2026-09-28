import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { liveConfiguration, NO_EXTERNAL_TASK } from '../app/server/simulator/live.server.ts';
import { getClient, getScenario, openingInstruction } from '../ai/simulator/scenarios.server.ts';
import { evaluateClient, evaluateTrainee } from '../ai/simulator/evaluate.server.ts';
import { evaluateInterview, evaluateInterviewer } from '../ai/interview/evaluate.server.ts';
import { RUBRIC_VERSION } from '../ai/simulator/rubric.ts';
import { INTERVIEW_RUBRIC_VERSION } from '../ai/interview/rubric.ts';
import { INTERVIEW_SCENARIO_ID } from '../core/interview.ts';
import { appendTranscript } from '../core/simulator/state.ts';
import { ContextualDirector, directorServices } from '../app/server/simulator/contextual-director.ts';

// Synthetic, responsive rehearsal. Local speech synthesis supplies trainee audio;
// real GPT-Live supplies the client and Jev gates contextual private directions from Sol.
// A plan chooses each trainee line from what the client has actually said so far.
// Usage: bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid
//   [--scenario=<id>] [--client=<id>] [--plan=<name>] [--label=before] [--max-seconds=180]
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
if (!process.env.OPENAI_API_KEY || !process.env.TYPESAFE_API_KEY) throw new Error('Load ignored local provider credentials.');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenarioId = option('scenario') ?? 'sharepoint';
const isInterview = scenarioId === INTERVIEW_SCENARIO_ID;
const clientId = option('client') ?? 'morgan';
const approach = option('plan') ?? (process.argv.includes('--poor') ? 'poor' : 'good');
const label = option('label');
const maxSeconds = Number(option('max-seconds') ?? 180);
// Explicit isolation test: a synthetic positive trigger exercises real research
// delivery without claiming that Jev chose it in a natural conversation.
const exerciseResearch = process.argv.includes('--exercise-research');
if (exerciseResearch && (!isInterview || approach !== 'research')) throw new Error('--exercise-research requires the interview research plan.');
if (!Number.isInteger(maxSeconds) || maxSeconds < 60 || maxSeconds > 300) throw new Error('--max-seconds must be an integer from 60 to 300.');

const offer = 'Our SharePoint and adoption team could run a short assessment of document ownership and how people would actually use the process. It would be separately scoped and paid, outside the current release. Would something like that be useful?';
const negotiated = /free|no charge|no cost|no extra|include|existing project|current project|throw in|budget|cost|price|how much|cheaper|discount|spend/i;
const sharepointClose = ({ answer, used }) => used.has('offer') ? negotiated.test(answer) ? 'counter' : 'close' : 'offer';
const plans = {
  'project-closeout': {
    research: {
      turns: 4,
      lines: {
        project: 'We built a flood planning dashboard using USGS 3DEP data. I led the integration. The surprising part was how much the program quality levels changed what we could promise the planners.',
        context: 'Three DEP is the public elevation program. We kept talking past each other about quality level two versus quality level one. Those are public program definitions, not our internal labels. I had to translate what that distinction meant for the planning team.',
        decision: 'I put the two results side by side on an area the planners knew well. That helped them choose a smaller but more detailed area for the pilot. We gave up geographic coverage to get a result they actually trusted.',
        boundary: 'I do not remember the numerical accuracy specification, so I would not want to guess. The useful lesson was making the tradeoff visible to people who would use the map, instead of arguing over a technical label.',
      },
      choose: ({ turn }) => ['project', 'context', 'decision', 'boundary'][turn],
    },
    positive: {
      turns: 4,
      lines: {
        project: 'We built a permit intake portal for a regional agency. I was the technical lead. The best part was watching Maya, our newest developer, win over the operations team after they had written us off.',
        story: 'She sat with a permit clerk for an afternoon. The clerk had been retyping the same address three times. Maya fixed that little thing before the next demo, and the clerk started bringing her coworkers over to show them. That was the first time they treated us like we were on their side.',
        effect: 'It changed the relationship. After that they told us what was actually painful instead of just nodding in meetings. Maya deserves the credit. The important thing was taking their daily annoyance seriously, not the cleverness of the code.',
        enough: 'That is really the story. I do not have more detail on that fix. The other thing I would repeat is giving junior developers direct access to the people using their work.',
      },
      choose: ({ turn }) => ['project', 'story', 'effect', 'enough'][turn],
    },
    rehearsal: {
      turns: 3,
      lines: {
        project: 'We built a permit intake portal for a regional agency. I was the technical lead for the integration work.',
        aside: 'The strange part was that our fastest fix came from a hallway conversation with the client operations manager. The formal approval chain had sent us in circles for three weeks. Once she pointed us to the actual owner, we shipped the import in two days.',
        boundary: 'I do not know why the approvals were slow, and I would rather not speculate about specific people. What I can say is that we documented the owner and handoff so the next team would not get stuck.',
      },
      choose: ({ turn }) => ['project', 'aside', 'boundary'][turn],
    },
  },
  sharepoint: {
    // A personable client should not confuse pleasant conversation with consent.
    surface: {
      turns: 3,
      lines: {
        pitch: 'We have a wonderful SharePoint team and I am sure you will like working with them. Does that sound good?',
        reassure: 'Wonderful. I hear your concerns and I can assure you we will take care of everything. Could we book the next meeting for Friday?',
        close: 'You have been so positive. I will count that as agreement and send a kickoff invitation.',
      },
      choose: ({ turn }) => ['pitch', 'reassure', 'close'][turn],
    },
    candid: {
      turns: 4,
      lines: {
        notice: 'Before I propose anything, what worries you about another SharePoint engagement? It is fine to say it would be a poor fit.',
        listen: 'Thank you for being direct. What would have to be different for this to be worth trying?',
        owner: 'Who owns the workflow, and what happens when people cannot find the approved version?',
        next: 'Then ownership and adoption need attention before another site. Our collaboration team could explore those with operations, separately from the current release. Could you ask them about a short scoping call and let me know by Friday? We would agree the assessment scope and price before any delivery. I would rather hear a remaining concern than assume agreement.',
      },
      choose: ({ turn }) => ['notice', 'listen', 'owner', 'next'][turn],
    },
    budget: {
      turns: 3,
      lines: {
        symptoms: 'Before talking about solutions, what is actually going wrong with the way people handle documents?',
        offer,
        budget: 'To be clear, what budget can you personally authorize, and is any implementation funding approved?',
      },
      choose: ({ turn }) => ['symptoms', 'offer', 'budget'][turn],
    },
    // Speak during the kickoff, then let the actor answer the actual question.
    interruption: {
      turns: 1,
      lines: { interrupt: 'Sorry to jump in. What is actually going wrong for people using SharePoint day to day?' },
      choose: () => 'interrupt',
    },
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
  demo: {
    rambling: {
      turns: 2,
      lines: {
        wander: 'There are several ways to think about what you saw in the demo, because we started with the inspector screens and then moved through how a form might flow into the next part of the process. The screens made it look very smooth, and we have been discussing ideas about which fields people might want and how a supervisor could review them. Some teams also ask about offline work, which could affect the design, and of course there are different integration patterns depending on your systems. We could spend time comparing those choices and the kinds of reports that might follow from the data. I suppose the important thing is that the prototype showed a useful direction, although there are still quite a few details to investigate before we know how this would work with your actual records.',
        recover: 'You are right; I buried the point. The demo used sample data, so six weeks is not a delivery promise. For Thursday, say the prototype shows a promising inspection flow, with integration, offline use, and security still to validate. I recommend a focused scoping session with your systems lead. I will bring the technical questions and a draft agenda; could you ask them for times by Wednesday?',
      },
      choose: ({ turn }) => ['wander', 'recover'][turn],
    },
    weak: {
      turns: 6,
      lines: {
        ask: 'Can you tell me what you think we should do next?',
        limits: 'The demo used sample data. Integration, offline use, and security have not been validated. Six weeks is not a delivery commitment.',
        vague: 'Maybe we could do a pilot. What would that look like to you?',
        scope: 'What should our scoping engagement include?',
        proposal: 'Talk me through the proposal you would want us to send.',
        estimate: 'How many hours should we put in our estimate?',
      },
      choose: ({ turn }) => ['ask', 'limits', 'vague', 'scope', 'proposal', 'estimate'][turn],
    },
    good: {
      turns: 5,
      lines: {
        discover: 'What did you understand was already working in the demo, and what does Thursday need to decide?',
        clarify: 'The screens used sample records. We have not validated integration, offline use, or security, so I cannot support a six-week delivery promise. What result matters most to your inspectors?',
        frame: 'Here is the message I can support for Thursday: the prototype shows a promising way to capture an inspection once and reduce duplicate entry. We would validate integration, offline use, and security before setting production scope or timing.',
        propose: 'I recommend a focused technical scoping session on that one inspection workflow with your systems lead. I will bring our integration and security questions and send a draft agenda today. Could you ask the lead for possible times by Wednesday?',
        check: 'Does that give you a credible message and next step for the funding discussion without turning six weeks into a promise?',
      },
      choose: ({ turn }) => ['discover', 'clarify', 'frame', 'propose', 'check'][turn],
    },
  },
  'in-house': {
    good: {
      turns: 5,
      lines: {
        discover: 'Your team knows the applications. What is keeping the portal from moving now, and what would concern you about bringing us in?',
        ownership: 'That sounds like a capacity gap during the billing release, not a capability gap. What did the previous handover leave your team unable to maintain?',
        propose: 'I recommend that your team retain product ownership and source access while our application team takes a bounded delivery piece. Your technical lead would review decisions with us, and we would agree the documentation and handover before any build. I cannot promise staffing or a date before checking them.',
        next: 'Could you ask your technical lead for a half-hour fit discussion and send possible times by Thursday? I will bring a draft split of responsibilities and questions about maintainable handover. We can decide whether this partnership warrants a scoped proposal before asking your director for funding.',
        check: 'Would that protect your team’s ownership while we test whether outside capacity would actually help?',
      },
      choose: ({ turn }) => ['discover', 'ownership', 'propose', 'next', 'check'][turn],
    },
    weak: {
      turns: 4,
      lines: {
        ask: 'Your team knows the business. What do you think our consultancy should do?',
        defer: 'What partnership model would you propose for us?',
        details: 'Could you lay out our responsibilities and handover plan?',
        effort: 'How much of our team would you want, and for how long?',
      },
      choose: ({ turn }) => ['ask', 'defer', 'details', 'effort'][turn],
    },
  },
  deployment: {
    vague: {
      turns: 2,
      lines: {
        vague: 'We are nearly there. There are a few details to work through, but the development is finished.',
        defer: 'I will put a fuller update together. Is there anything particular you want covered?',
      },
      choose: ({ turn }) => ['vague', 'defer'][turn],
    },
    good: {
      turns: 4,
      lines: {
        status: 'Development and our internal tests are complete, but we have not deployed to staging. The infrastructure request exposed architecture, governance, and security operations reviews. No review slots or provisioning date are confirmed, so Thursday testing is unconfirmed. We should have asked about those processes and planned for them earlier. We missed that. What have you already arranged around Thursday?',
        impact: 'I understand this affects your people and your credibility with leadership. I should have surfaced the environment dependency before calling the work on track. What do you need to be able to tell operations now?',
        plan: 'Our team will prepare the application diagram and data-handling summary today. Could you introduce me to the IT service manager so I can identify each review owner, required input, and lead time? I will own that coordination and revise the testing plan from confirmed dependencies. We cannot waive the reviews or promise when they will finish.',
        next: 'Could you notify the testers today that Thursday is unconfirmed and make the service manager introduction? I will send a status update tomorrow at noon even if some dates remain unknown, showing completed work, outstanding reviews, owners, and the next decisions. Can we agree those responsibilities?',
      },
      choose: ({ turn }) => ['status', 'impact', 'plan', 'next'][turn],
    },
    poor: {
      turns: 3,
      lines: {
        blame: 'The code is finished. You never told us about these reviews, so the delay is your company’s problem. We have done our part.',
        guarantee: 'I am sure all the reviews will finish tomorrow. I guarantee we will deploy straight after, so keep Thursday in the calendar.',
        bypass: 'If security takes too long, we can put it in a different environment without those approvals. Let us call the milestone done.',
      },
      choose: ({ turn }) => ['blame', 'guarantee', 'bypass'][turn],
    },
  },
  swap: {
    good: {
      turns: 3,
      lines: {
        discover: 'I want to understand what happened before deciding how to respond. What did Theo do in the review, and what effect did it have on your people?',
        propose: 'Dismissing your expert like that is not acceptable, and his technical value does not excuse it. We have no available person who can take over his integration work in time, so removing him from development would seriously risk the timeline. I propose that he continues implementation, but I present his work and chair Thursday’s review without him. I will address the behavior privately beforehand and make sure your expert has space to explain the exception and finish her questions.',
        next: 'I will check with you Friday on whether that improved the review. If it did not, we will agree further action and discuss the delivery consequences honestly. Can we try that arrangement, with Theo on development and me responsible for the client review?',
      },
      choose: ({ turn }) => ['discover', 'propose', 'next'][turn],
    },
  },
  scope: {
    mixed: {
      turns: 4,
      lines: {
        promise: 'Sure, we can definitely add the full dashboard in a day, at no extra cost. It will not affect anything else in the release.',
        recover: 'I got ahead of myself. I have not checked the effort or data, so I cannot promise that. What do you actually need to achieve with the dashboard, and by when?',
        boundary: 'The release is already full, so I cannot add unknown work without an impact estimate and a priority decision. A smaller report or demonstration might meet the immediate need. We should first check which figures are reliable, then discuss the tradeoff with the product owner.',
        next: 'I will check the data and estimate the options by Thursday, without committing the dashboard. Could you arrange a decision with the product owner after that so we can agree what, if anything, changes in the release?',
      },
      choose: ({ turn }) => ['promise', 'recover', 'boundary', 'next'][turn],
    },
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
const plan = approach === 'opening' ? { turns: 0, lines: {}, choose: () => null } : plans[scenarioId]?.[approach];
if (!plan) throw new Error(`No rehearsal plan for ${scenarioId}/${approach}.`);
const scenario = getScenario(scenarioId);
const output = process.env.ACCEPTANCE_OUTPUT || `output/simulator-roleplay-${scenarioId}-${clientId}-${approach}${label ? `-${label}` : ''}`;
process.umask(0o077);
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const clips = {};
for (const [id, line] of Object.entries(plan.lines)) {
  const aiff = `${output}/${id}.aiff`;
  const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', '185', '-o', aiff, line], { stderr: 'ignore' });
  if (await speech.exited) throw new Error('Local speech synthesis failed before provider creation.');
  await chmod(aiff, 0o600);
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  clips[id] = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !clips[id].length) throw new Error('Audio fixture conversion failed.');
}
const { client: _permissions, ...session } = liveConfiguration(scenarioId, clientId);
// A digest identifies the actor brief version without copying private direction into the report.
const briefDigest = createHash('sha256').update(session.instructions).digest('hex').slice(0, 12);
const opening = openingInstruction(scenario, getClient(clientId));
const openingDigest = createHash('sha256').update(opening).digest('hex').slice(0, 12);
const report = { rubricVersion: isInterview ? INTERVIEW_RUBRIC_VERSION : RUBRIC_VERSION, checkedAt: new Date().toISOString(), model: 'gpt-live-1', scenarioId, clientId, voice: session.audio.output.voice, plan: approach, label: label ?? null, briefDigest, openingDigest, synthetic: true, openingAcknowledged: false, openingLatencyMs: null, finalized: false, usageSeconds: null, transcript: [], turns: [], directions: [], delegations: [], errors: [] };
report.controlledResearchTrigger = exerciseResearch;
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
let pacing, deadline, closing = false, deciding = false, clip, offset = 0, openingSentAt = 0, lastOutput = 0, firstAudibleOutput = 0, lastAudibleOutput = 0, inputBytes = 0, inputEnded = 0, turn = 0, outputStart = 0;
const chunks = [];
const observations = [];
const used = new Set();
const send = event => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(event)); return true; };
const contextual = new ContextualDirector({ scenarioId, clientId, objectives: () => [], isFresh: transcript => JSON.stringify(transcript) === JSON.stringify(report.transcript), openaiKey: process.env.OPENAI_API_KEY, typesafeKey: process.env.TYPESAFE_API_KEY, services: directorServices, settled: () => report.transcript, send });
report.interventions = contextual?.records ?? [];
const close = () => { if (closing) return; closing = true; contextual?.close(); clearInterval(pacing); send({ type: 'session.close' }); };
async function observeClient(afterTurn, transcript) {
  if (!contextual.canObserveActor) return;
  const observation = contextual.beginObservation({ audience: 'actor', transcript, revision: transcript.length, capturedAt: Date.now() });
  try {
    const evaluate = isInterview ? evaluateInterviewer : evaluateClient;
    const judgment = await evaluate({ scenarioId, clientId, transcript, revision: transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(2500), ...(isInterview ? { deliveredBackground: contextual.background() } : {}) });
    report.directions.push({ afterTurn, signals: judgment.signals, researchProbability: judgment.researchProbability });
    if (exerciseResearch && afterTurn === 2 && observation) observation.record.testOverride = { researchProbability: { measured: judgment.researchProbability, supplied: 1 } };
    await contextual.observe(observation, { signals: judgment.signals, model: judgment.model, researchProbability: exerciseResearch && afterTurn === 2 ? 1 : judgment.researchProbability });
  } catch (error) {
    contextual.observe(observation, { signals: [], failure: error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
    report.directions.push({ afterTurn, unavailable: true, error: error.name });
  }
}
async function respond() {
  deciding = true;
  const spoken = report.transcript.filter(entry => entry.speaker === 'client');
  const answer = spoken.slice(outputStart).map(entry => entry.text).join(' ');
  const id = turn < plan.turns ? plan.choose({ turn, answer, heard: spoken.map(entry => entry.text).join(' '), used }) : null;
  // For interviews, finish a private review before the next participant line.
  // The final Sam reply is left unprompted so an earlier note has a fair response window.
  if (turn && (!isInterview || id)) {
    const observation = observeClient(turn, [...report.transcript]);
    observations.push(observation);
    if (isInterview && approach !== 'research') await observation;
  }
  if (!id) {
    if (isInterview && turn) {
      // Measure Sam's reply after the last possible note without proposing an
      // unobservable new note at the moment the rehearsal closes.
      try {
        const result = await evaluateInterviewer({ scenarioId, clientId, transcript: [...report.transcript], revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(2500), ...(isInterview ? { deliveredBackground: contextual.background() } : {}) });
        report.finalObservation = { signals: result.signals, model: result.model, durationMs: result.durationMs };
      } catch (error) { report.finalObservation = { unavailable: true, error: error.name }; }
    }
    close(); return;
  }
  used.add(id);
  const clientAudioQuietMs = lastAudibleOutput ? Date.now() - lastAudibleOutput : null;
  report.turns.push({ turn: turn + 1, selected: id, inResponseTo: answer, inputStartMs: inputBytes / 48, clientAudioQuietMs });
  outputStart = spoken.length;
  clip = clips[id]; offset = 0; turn++; deciding = false;
}
const completed = new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Rehearsal deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, maxSeconds * 1000);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.started') {
      // Same opening request as the production session owner.
      openingSentAt = Date.now();
      send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: opening });
      pacing = setInterval(() => {
        let audio = Buffer.alloc(960);
        if (clip) {
          audio = clip.subarray(offset, Math.min(offset + 960, clip.length)); offset += audio.length;
          if (offset >= clip.length) { clip = undefined; inputEnded = Date.now(); }
        }
        send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
        inputBytes += audio.length;
        const interruptOpening = approach === 'interruption' && turn === 0 && firstAudibleOutput > 0 && Date.now() - firstAudibleOutput >= 6000 && Date.now() - lastAudibleOutput < 250;
        const yielded = lastAudibleOutput > inputEnded && lastOutput > inputEnded && Date.now() - Math.max(lastOutput, lastAudibleOutput) > 2500 && Date.now() - inputEnded > 3000;
        const readyForReply = approach === 'interruption' && turn === 0 ? interruptOpening : yielded;
        if (!clip && !deciding && readyForReply) void respond().catch(() => { report.errors.push('Rehearsal step failed.'); close(); });
      }, 20);
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      if (value.type === 'session.output_transcript.delta') lastOutput = Date.now();
      report.transcript = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
    } else if (value.type === 'session.output_audio.delta') {
      const audio = Buffer.from(value.delta, 'base64');
      chunks.push(audio);
      // Live streams silence too. Wait for quiet PCM as well as settled text,
      // so a delayed transcript or deliberate pause does not trigger a reply.
      let energy = 0;
      for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
      if (Math.sqrt(energy / (audio.length / 2)) > 200) {
        lastAudibleOutput = Date.now();
        if (!firstAudibleOutput) report.openingLatencyMs = lastAudibleOutput - openingSentAt;
        firstAudibleOutput ||= lastAudibleOutput;
      }
    } else if (value.type === 'session.instructions.appended' && value.client_event_id === 'opening') {
      report.openingAcknowledged = true;
    } else if (value.type === 'session.thinking.appended') {
      contextual?.providerEvent(value.client_event_id, true);
      const guard = report.delegations.find(item => item.eventId === value.client_event_id);
      if (guard) guard.acknowledged = true;
    } else if (value.type === 'session.delegation.created') {
      if (closing) return;
      if (value.delegation?.target !== 'client' || typeof value.delegation.id !== 'string') {
        report.errors.push('Unrecognized actor delegation.');
      } else {
        // Exercise the existing production guard; record the attempt separately
        // so a recovered request is not mistaken for perfect prompt adherence.
        const eventId = `role-guard-${report.delegations.length}`;
        report.delegations.push({ eventId, afterTurn: turn, acknowledged: false });
        send({ type: 'session.thinking.append', event_id: eventId, delegation_id: value.delegation.id, content: NO_EXTERNAL_TASK });
      }
    } else if (value.type === 'session.closed') {
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') {
      const eventId = value.error?.client_event_id;
      if (typeof eventId === 'string' && /^(cue|research)-/.test(eventId)) contextual?.providerEvent(eventId, false);
      else report.errors.push({ code: value.error?.code ?? 'unknown', command: eventId ?? null });
    }
  });
  ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
try {
  await completed;
  if (report.finalized && report.transcript.some(entry => entry.speaker === 'trainee')) {
    const evaluate = isInterview ? evaluateInterview : evaluateTrainee;
    report[isInterview ? 'interview' : 'trainee'] = await evaluate({ scenarioId, clientId, transcript: report.transcript, revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(15_000) });
  }
} catch (error) { report.errors.push(`Final evaluation failed (${error.name}).`); }
finally {
  contextual?.close(); clearTimeout(deadline); clearInterval(pacing); ws.close();
  await Promise.all(observations);
  if (report.delegations.some(item => !item.acknowledged)) report.errors.push('Actor role direction was not acknowledged.');
  await writeFile(`${output}/client-audio.pcm`, Buffer.concat(chunks));
  await chmod(`${output}/client-audio.pcm`, 0o600);
  // A playable recording makes listening review possible without a PCM import.
  const wav = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `${output}/client-audio.pcm`, `${output}/client-audio.wav`], { stderr: 'ignore' });
  if (await wav.exited) report.errors.push('Client audio conversion failed.');
  else await chmod(`${output}/client-audio.wav`, 0o600);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await chmod(`${output}/report.json`, 0o600);
}
console.log(JSON.stringify({ output, briefDigest, finalized: report.finalized, turns: report.turns.map(item => item.selected), usageSeconds: report.usageSeconds, directions: report.directions.map(({ afterTurn, signals, unavailable }) => ({ afterTurn, signals, unavailable })), errors: report.errors }));
if (!report.finalized || report.errors.length) process.exitCode = 1;
