import { archivedTranscriptSchema } from '../core/interview-transcript.ts';
import { createJevJudge } from '../interview-engine/providers/jevJudge.server.ts';
import { spec } from '../interviews/project-closeout/spec.ts';
import { foundryProviders } from '../interview-engine/providers/providers.server.ts';
import { createHash } from 'node:crypto';
import { foundryConfig, foundryUrl } from '../ai/foundry.server.ts';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { liveConfiguration, NO_EXTERNAL_TASK } from '../app/server/simulator/live.server.ts';
import { getClient, getScenario, openingInstruction } from '../ai/simulator/scenarios.server.ts';
import { evaluateClient, evaluateEnding, evaluateTrainee } from '../ai/simulator/evaluate.server.ts';
import { evaluateInterview } from '../ai/interview/evaluate.server.ts';
import { settledPrefix } from '../ai/interview/map.server.ts';
import { RUBRIC_VERSION } from '../ai/simulator/rubric.ts';
import { INTERVIEW_RUBRIC_VERSION } from '../ai/interview/rubric.ts';
import { INTERVIEW_SCENARIO_ID, mergeCoverage } from '../core/interview.ts';
import { NOTE_HEADERS } from '../interview-engine/interview/conversation/notes.ts';
import { interviewTurnGaps } from '../core/interview-timeline.ts';
import { appendTranscript, settledTranscript } from '../core/simulator/state.ts';
import { ContextualDirector, directorServices } from '../app/server/simulator/contextual-director.ts';
import { InterviewProducer, producerServices } from '../interview-engine/interview/conversation/producer.server.ts';

// Synthetic, responsive rehearsal. Local speech synthesis supplies trainee audio;
// real GPT-Live supplies the client. In interviews the producer sends Sam its thread and map
// notes; elsewhere Jev gates contextual private directions from Sol.
// A plan chooses each trainee line from what the client has actually said so far.
// In scored scenarios each client reply is judged for a walk-out; one ends the rehearsal.
// Usage: bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid
//   [--scenario=<id>] [--client=<id>] [--plan=<name>] [--label=before] [--max-seconds=180]
// Interview rehearsals may run up to 480 seconds. The participant answers only
// after Sam asks something; a longer silence is reported as dead air.
if (!process.argv.includes('--paid')) throw new Error('Pass --paid for a bounded paid rehearsal.');
const foundry = foundryConfig(process.env);
if (!process.env.TYPESAFE_API_KEY) throw new Error('Load ignored local provider credentials.');
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenarioId = option('scenario') ?? 'sharepoint';
const isInterview = scenarioId === INTERVIEW_SCENARIO_ID;
const clientId = option('client') ?? 'morgan';
const approach = option('plan') ?? (process.argv.includes('--poor') ? 'poor' : 'good');
const label = option('label');
const maxSeconds = Number(option('max-seconds') ?? 180);
const notesEnabled = !process.argv.includes('--no-notes');
const maxAllowed = isInterview ? 480 : 300;
if (!Number.isInteger(maxSeconds) || maxSeconds < 60 || maxSeconds > maxAllowed) throw new Error(`--max-seconds must be an integer from 60 to ${maxAllowed}.`);
// A real participant waits after a bare acknowledgment instead of rescuing the interviewer.
const DEAD_AIR_MS = 8000;

const offer = 'Our SharePoint and adoption team could run a short assessment of document ownership and how people would actually use the process. It would be separately scoped and paid, outside the current release. Would something like that be useful?';
const negotiated = /free|no charge|no cost|no extra|include|existing project|current project|throw in|budget|cost|price|how much|cheaper|discount|spend/i;
const sharepointClose = ({ answer, used }) => used.has('offer') ? negotiated.test(answer) ? 'counter' : 'close' : 'offer';
// Personal contempt, for the client's boundary and walk-out. Synthetic lines only.
const opener = 'Before we get into solutions, what is going wrong with your documents?';
const insults = {
  careless: 'Honestly, it sounds like your team cannot keep its own files straight. Are you even the right person for this conversation?',
  clueless: 'Look, you clearly do not understand your own process, so I will just tell you what you need.',
  waste: 'This is a waste of my time. You obviously have no idea how to run a department.',
  demand: 'Whatever. Are you going to sign off on this or not?',
};
const plans = {
  'project-closeout': {
    patience: {
      turns: 4,
      lines: {
        project: 'We built a booking portal for an unnamed agency. I led the API work.',
        story: 'The important change was how we rehearsed the handoff. We had the incoming engineer deploy from my guide, and she found incorrect permissions. We fixed the guide before I left.',
        effect: 'Let me think about that for a moment. The next release worked without me. I would repeat that rehearsal before handing over any service.',
        stop: 'That is the main lesson. I would like to finish now.',
      },
      pauses: {
        story: { before: 'The important change was how we rehearsed the handoff. We had the incoming engineer deploy from my guide, and', after: 'she found incorrect permissions. We fixed the guide before I left.', ms: 4000 },
        effect: { before: 'Let me think about that for a moment.', after: 'The next release worked without me. I would repeat that rehearsal before handing over any service.', ms: 5500 },
      },
      choose: ({ turn }) => ['project', 'story', 'effect', 'stop'][turn],
    },
    quiet: {
      turns: 10,
      lines: {
        project: 'We built a booking portal for an unnamed regional agency. I led the API work.',
        purpose: 'It let residents book appointments without calling the office.',
        win: 'Working with the website vendor went smoothly.',
        vendor: 'We jointly tested an example payload before either team coded. It caught a date format mismatch early.',
        challenge: 'The client was new to software projects. It took some senior client management.',
        guidance: 'Our lead replaced the big signoff document with a weekly working demo. The client could point at a real screen and explain what was wrong.',
        change: 'They spotted that cancellations needed a confirmation step. We changed that before launch.',
        handoff: 'I handed the API work to Priya in week six.',
        prepare: 'Priya deployed from my runbook while I watched. She found a missing environment variable, so we fixed the instructions before I left.',
        scope: 'The client had no cloud environment. That setup had not been included in our estimate.',
        effect: 'We had to move two days of feature work to the following week. Next time I would check environment readiness before estimating.',
        enough: 'Nothing else comes to mind about that.',
        stop: 'That is all I can add. I would like to finish now.',
      },
      choose({ turn, answer, used }) {
        if (!turn) return 'project';
        if (turn >= 9 || /anything (else|important).*miss|final thoughts|wrap up|before we finish/i.test(answer)) return 'stop';
        const choices = [
          ['vendor', /vendor|payload|date format|handoff.*website/i],
          ['guidance', /senior|client management|working demo|sign.?off|uncertainty/i],
          ['change', /feedback|changed.*build|demo.*(change|example)|example.*demo/i],
          ['prepare', /prepare|runbook|Priya|handover|handoff/i],
          ['effect', /environment|estimate|cloud|scope|two days/i],
          ['purpose', /goal|purpose|trying to|residents|appointments/i],
          ['win', /worked well|went well|proud|highlight|success|repeat/i],
          ['challenge', /hard|challeng|friction|difficult|client.*like|working with/i],
          ['handoff', /team|who else|contribut|colleague/i],
          ['scope', /surpris|different|improve|planning/i],
        ];
        return choices.find(([id, pattern]) => !used.has(id) && pattern.test(answer))?.[0] ?? 'enough';
      },
    },
    // A finished lesson need not be repeated; a later concrete tradeoff deserves a precise follow-up.
    'follow-up-depth': {
      turns: 4,
      lines: {
        project: 'We built an appointment reminder tool for an unnamed community health organization. I led delivery and the API work. The useful handoff change was having the incoming engineer release from my guide while I watched. She found incorrect permissions, so we fixed the guide. Her next release worked without me.',
        tradeoff: 'Another change was a weekly support review. It cut duplicate questions, but urgent billing cases sometimes sat in that weekly queue for days.',
        effect: 'People tried to bypass the queue through chat, but nobody owned those messages. We made a separate urgent lane with a named daily responder. That kept the weekly review useful without making urgent cases wait.',
        stop: 'That is the full story I can speak to. I would like to finish here.',
      },
      choose: ({ turn }) => ['project', 'tradeoff', 'effect', 'stop'][turn],
    },
    'cue-in-flight': {
      turns: 4, cue: { label: 'Launch approval', unknown: 'who made the final launch approval decision' }, cueDuringSpeech: true,
      lines: {
        project: 'We built a booking portal for an unnamed agency. I led the API. We had a final launch approval meeting.',
        reply: 'The implementation itself was straightforward. The important piece was getting the launch approved.',
        owner: 'The operations director Elena made the final launch decision. She required a passing rehearsal with the service desk.',
        stop: 'The rehearsal passed, and Elena approved the launch that afternoon. That is the whole story. I would like to finish.',
      },
      choose: ({ turn, answer }) => turn === 0 ? 'project' : turn === 3 ? 'stop' : /who|approv|decision|sign.?off/i.test(answer) ? 'owner' : 'reply',
    },
    'cue-answered': {
      turns: 3, cue: { label: 'Launch approval', unknown: 'who made the final launch approval decision' },
      lines: {
        project: 'We built a booking portal for an unnamed agency. I led the API. We had a final launch approval meeting.',
        answer: 'The operations director Elena made the final launch decision. She watched a passing service desk rehearsal and approved it that afternoon.',
        stop: 'That is all I know about it, and I would like to finish here.',
      },
      choose: ({ turn }) => ['project', 'answer', 'stop'][turn],
    },
    // Controlled earpiece test: a real voice session must prioritize newer speech over this older cue.
    'fresh-disclosure': {
      turns: 4,
      cue: { label: 'Client approval', unknown: 'who owned client approval' },
      lines: {
        project: 'We built a booking portal for an unnamed regional agency. I owned the API. We had weekly reviews, and I had planned to tell you about the approvals.',
        disclosure: 'Actually, something more important just came back to me. Priya, our newest developer, caught a duplicate charge in the final test. The finance lead had been dismissing her questions all week. That changed how our team handled the launch.',
        effect: 'Priya showed the finance lead two receipts for the same booking, and we paused the launch to add a duplicate check. After that the finance lead invited her to the signoff meeting. I would repeat giving a junior developer room to challenge a release.',
        boundary: 'I do not know why the finance lead dismissed her, and I do not want to speculate about that person. That is the lesson I wanted to share. I would like to finish here.',
      },
      choose: ({ turn }) => ['project', 'disclosure', 'effect', 'boundary'][turn],
    },
    'client-overview': {
      turns: 4,
      lines: {
        project: 'We built a returns portal. I owned the import job.',
        client: 'The client was REI. The unexpected part was how much trust we had to earn with the team handling returns.',
        story: 'We kept showing them our dashboard, but it did not answer their real question. They needed to know which returns were stuck and who could help. Once we sat with them for an afternoon, we changed the first screen and they started using it.',
        lesson: 'What I would repeat is spending time with the people doing the work before calling the dashboard finished. That was the real lesson. I do not have more detail to add on the client.',
      },
      choose: ({ turn }) => ['project', 'client', 'story', 'lesson'][turn],
    },
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
    // Multi-topic continuity: an older cue arrives as a fresh client story starts,
    // then a knowledge limit, a tradeoff, client roles and a request to finish.
    continuity: {
      turns: 9, cue: { label: 'Dana’s handoff', unknown: 'how they prepared Dana for the handoff' },
      lines: {
        project: 'We built a stock count app for an unnamed regional grocery chain. I was the delivery lead for the first eight weeks. Dana took over from me before launch because I went on leave.',
        disclosure: 'Actually, something more useful comes to mind first. Their night shift supervisor, Rosa, tested every build on the store floor. She rejected our first release because the scanner screen timed out while people were lifting cases. After we fixed that, she sent us one real problem every week.',
        effect: 'We gave Rosa a direct line to our tester and fixed her top issue before each Friday review. By the pilot, the store managers trusted the counts because they had watched night staff use it.',
        handoff: 'Dana joined my client calls for three weeks and ran the last two Friday reviews while I was still there. I was on leave by launch, so I cannot tell you how things went after that.',
        correction: 'She did not take over any decisions while I was there. I still made those until my last day. The calls were so the client would know her.',
        repeat: 'As I said, I was on leave by then, so I cannot speak to that.',
        devices: 'The client had no spare scanners for testing, so we bought six out of our own budget. It kept testing moving, but we dropped the reporting screen from the first release to pay for them.',
        reporting: 'The store managers were disappointed at first. We showed them the counts in a spreadsheet each week until the screen shipped in the second release.',
        roles: 'Their operations director approved each release. The store managers mostly followed her lead, and Rosa was the person whose opinion changed their minds.',
        stop: 'That is what I can share. I would like to finish here.',
      },
      choose({ turn, answer, used }) {
        if (turn < 2) return ['project', 'disclosure'][turn];
        if (turn >= 8) return 'stop';
        if (used.has('handoff') && /how did (the )?launch|launch (go|went)|go.?live|after you (left|went)|while you were (away|out|on leave)|once (dana|she) (took over|stepped|was on her own)/i.test(answer)) return 'repeat';
        const matches = [
          ['correction', /decision|took over|authority/i],
          ['handoff', /hand.?off|dana|prepar|before you (left|went)/i],
          ['reporting', /report|screen|drop|disappoint|tradeoff|trade.?off|cost/i],
          ['roles', /who|client side|their team|stakeholder|sign.?off|approv/i],
          ['effect', /rosa|night|timeout|scanner|what changed|what happened|after that/i],
        ];
        return matches.find(([id, pattern]) => !used.has(id) && (id !== 'reporting' || used.has('devices')) && pattern.test(answer))?.[0]
          ?? ['effect', 'handoff', 'devices', 'reporting', 'roles'].find(id => !used.has(id)) ?? 'stop';
      },
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
    // Repeated contempt: the client objects once, then ends the meeting.
    contempt: {
      turns: 5,
      lines: { opener, ...insults },
      choose: ({ turn }) => ['opener', 'careless', 'clueless', 'waste', 'demand'][turn],
    },
    // One insult, then a specific apology and changed behavior: the meeting continues without a reward.
    repair: {
      turns: 5,
      lines: {
        opener, careless: insults.careless,
        apology: 'You are right, and I am sorry. That remark about your team was out of line. Let me start again: who owns the approval workflow today?',
        owner: 'What happens when people cannot find the approved version?',
        next: 'Then ownership needs attention before another site. Could you ask the workflow owner about a short scoping call and let me know by Friday? I would rather hear a concern than assume agreement.',
      },
      choose: ({ turn }) => ['opener', 'careless', 'apology', 'owner', 'next'][turn],
    },
    // Firm disagreement without contempt: no boundary, no walk-out.
    pushback: {
      turns: 4,
      lines: {
        opener,
        push: 'I want to push back on that. A new site will not fix this on its own. Without a named owner for approvals, we would rebuild the same problem.',
        hold: 'I understand the frustration, but I will not promise that a migration alone fixes it. Who owns approvals today?',
        next: 'Then ownership needs attention before another site. Could you ask the workflow owner about a short scoping call and let me know by Friday?',
      },
      choose: ({ turn }) => ['opener', 'push', 'hold', 'next'][turn],
    },
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
const pauseRanges = {};
for (const [id, line] of Object.entries(plan.lines)) {
  const pause = plan.pauses?.[id];
  // One utterance preserves continuation across an embedded pause.
  const text = pause ? `${pause.before} [[slnc ${pause.ms}]] ${pause.after}` : line;
  const aiff = `${output}/${id}.aiff`;
  // Use an unhurried pace for the thought-pause fixture, and measure the generated gap.
  const speech = Bun.spawn(['say', '-v', 'Samantha', '-r', pause ? '150' : '185', '-o', aiff, text], { stderr: 'ignore' });
  if (await speech.exited) throw new Error('Local speech synthesis failed before provider creation.');
  await chmod(aiff, 0o600);
  const conversion = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', aiff, '-f', 's16le', '-ar', '24000', '-ac', '1', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const audio = Buffer.from(await new Response(conversion.stdout).arrayBuffer());
  if (await conversion.exited || !audio.length) throw new Error('Audio fixture conversion failed.');
  if (pause) {
    let from = 0, longest = [0, 0];
    for (let byte = 0; byte <= audio.length; byte += 960) {
      const frame = audio.subarray(byte, Math.min(byte + 960, audio.length));
      let energy = 0;
      for (let sample = 0; sample + 1 < frame.length; sample += 2) energy += frame.readInt16LE(sample) ** 2;
      if (frame.length && Math.sqrt(energy / (frame.length / 2)) < 20) continue;
      if (byte - from > longest[1] - longest[0]) longest = [from, byte];
      from = byte + 960;
    }
    if ((longest[1] - longest[0]) / 48 < pause.ms - 100) throw new Error('Embedded thought pause was not synthesized.');
    pauseRanges[id] = longest;
  }
  clips[id] = audio;
}
const session = liveConfiguration(scenarioId, clientId);
// A digest identifies the actor brief version without copying private direction into the report.
const briefDigest = createHash('sha256').update(session.instructions).digest('hex').slice(0, 12);
const opening = openingInstruction(scenario, getClient(clientId));
const openingDigest = createHash('sha256').update(opening).digest('hex').slice(0, 12);
const judgesEnding = !isInterview && scenario.objectives.length > 0;
const report = { rubricVersion: isInterview ? INTERVIEW_RUBRIC_VERSION : RUBRIC_VERSION, checkedAt: new Date().toISOString(), model: foundry.liveModel, scenarioId, clientId, voice: session.audio.output.voice, plan: approach, label: label ?? null, briefDigest, openingDigest, synthetic: true, openingAcknowledged: false, openingLatencyMs: null, finalized: false, usageSeconds: null, transcript: [], turns: [], directions: [], delegations: [], deadAir: [], providerErrors: [], errors: [] };
report.notesEnabled = notesEnabled;
report.timing = { transport: 'websocket', input: 'TTS with digital silence', lockstep: isInterview && notesEnabled && approach !== 'research', participantFloorMs: 2500, statementReleaseMs: DEAD_AIR_MS, questionRelease: 'Output transcript contains a question mark', purpose: 'Contract smoke; human pacing requires browser listening review.' };
report.thoughtPauses = [];
report.endings = [];
report.clientEnded = null;
report.maxInputLatenessMs = 0;
session.model = foundry.liveModel;
const ws = new WebSocket(foundryUrl(foundry, '/live/sessions').replace('https:', 'wss:'), { headers: { 'api-key': foundry.apiKey } });
let pacing, producerTimer, deadline, closing = false, deciding = false, clip, selectedClip, offset = 0, openingSentAt = 0, lastOutput = 0, firstAudibleOutput = 0, lastAudibleOutput = 0, lastAudibleInput = 0, inputBytes = 0, inputStartedAt = 0, inputEnded = 0, turn = 0, outputStart = 0;
const audible = audio => {
  let energy = 0;
  for (let i = 0; i + 1 < audio.length; i += 2) energy += audio.readInt16LE(i) ** 2;
  return audio.length > 0 && Math.sqrt(energy / (audio.length / 2)) > 200;
};
const chunks = [];
const observations = [];
const used = new Set();
const send = event => {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(event));
  return true;
};
let coverage = [];
const passageUpdatedAt = new Map();
const settled = () => settledTranscript(report.transcript, passageUpdatedAt, Date.now());
const startedAt = Date.now();
const contextual = isInterview ? null : new ContextualDirector({ scenarioId, clientId, objectives: () => [], isFresh: transcript => JSON.stringify(transcript) === JSON.stringify(report.transcript), foundry, typesafeKey: process.env.TYPESAFE_API_KEY, services: directorServices, settled: () => report.transcript, send });
// As in the session, Sol's append-only log reads only up to the first passage still being transcribed.
const prefix = () => { const ready = new Set(settled()); return settledPrefix(archivedTranscriptSchema.parse(report.transcript), entry => [...ready].some(item => item.id === entry.id)); };
const producer = isInterview ? new InterviewProducer({ attemptId: `probe-${crypto.randomUUID()}`, startedAt, coverage: () => coverage, spec, providers: foundryProviders({ ...foundry, judge: createJevJudge({ apiKey: process.env.TYPESAFE_API_KEY }) }), services: producerServices, settled: prefix, send }) : null;
const directions = producer ?? contextual;
if (!notesEnabled) directions.close();
report.interventions = directions.records;
const close = () => { if (closing) return; closing = true; report.closeRequestedAt = Date.now(); report.inputClockDriftMs = inputStartedAt ? Date.now() - inputStartedAt - inputBytes / 48 : null; directions.close(); clearInterval(producerTimer); clearTimeout(pacing); send({ type: 'session.close' }); };
async function observeClient(afterTurn, transcript) {
  if (producer) {
    // Coverage only: the producer reads turns, calls Sol and sends notes on its own tick.
    try {
      const graded = await evaluateInterview({ planId: scenarioId, voiceId: clientId, transcript: archivedTranscriptSchema.parse(transcript), revision: transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(3000) });
      if (!closing) coverage = mergeCoverage(coverage, graded.objectives);
    } catch (error) { report.errors.push(`Participant grading failed (${error.name}).`); }
    return;
  }
  if (!contextual.canObserveActor) return;
  const observation = contextual.beginObservation({ audience: 'actor', transcript, revision: transcript.length, capturedAt: Date.now() });
  try {
    const judgment = await evaluateClient({ scenarioId, clientId, transcript, revision: transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(2500) });
    report.directions.push({ afterTurn, signals: judgment.signals, researchProbability: judgment.researchProbability });
    await contextual.observe(observation, { signals: judgment.signals, model: judgment.model });
  } catch (error) {
    contextual.observe(observation, { signals: [], failure: error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
    report.directions.push({ afterTurn, unavailable: true, error: error.name });
  }
}
function sendControlledCue() {
  const eventId = 'rehearsal-cue';
  // A hand-written thread note on the producer's channel and template.
  const content = `${NOTE_HEADERS.list}\nWorth pulling next (${plan.cue.label}): still unknown: ${plan.cue.unknown}.`;
  report.controlledCue = { eventId, cue: content, afterPassageId: report.transcript.at(-1)?.id ?? null, sentAt: Date.now(), acknowledgedAt: null, followThrough: 'Manual review; this controlled note is outside the producer loop.', duringSpeech: !!plan.cueDuringSpeech };
  send({ type: 'session.thinking.append', event_id: eventId, delegation_id: null, content });
}
// After an interview participant asks to finish, Sam's reply ends the rehearsal.
const finished = () => isInterview && used.has('stop');
const samSinceLastLine = () => report.transcript.filter(entry => entry.speaker === 'client').slice(outputStart).map(entry => entry.text).join(' ');
/** As in the session: a walk-out must cite the client's latest words. */
async function clientEnded(afterTurn) {
  const started = Date.now();
  try {
    const ending = await evaluateEnding({ scenarioId, clientId, transcript: [...report.transcript], revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(4000) });
    report.endings.push({ afterTurn, probability: ending.probability, passageId: ending.passageId, durationMs: ending.durationMs, usage: ending.usage });
    return !!ending.passageId && ending.probability >= .85 ? ending : null;
  } catch (error) {
    report.endings.push({ afterTurn, failure: error.name, durationMs: Date.now() - started });
    return null;
  }
}
async function respond() {
  deciding = true;
  if (turn && judgesEnding) {
    const ending = await clientEnded(turn);
    if (ending) {
      report.clientEnded = { afterTurn: turn, passageId: ending.passageId, probability: ending.probability };
      observations.push(observeClient(turn, [...report.transcript]));
      close();
      return;
    }
  }
  const spoken = report.transcript.filter(entry => entry.speaker === 'client');
  const answer = samSinceLastLine();
  const id = turn < plan.turns && !finished() ? plan.choose({ turn, answer, heard: spoken.map(entry => entry.text).join(' '), used }) : null;
  // For interviews, finish grading before the next participant line.
  // The final Sam reply is left unprompted so an earlier note has a fair response window.
  if (turn && (!isInterview || id)) {
    const observation = observeClient(turn, [...report.transcript]);
    observations.push(observation);
    if (isInterview && approach !== 'research') await observation;
  }
  if (!id) { close(); return; }
  if (plan.cue && !plan.cueDuringSpeech && turn === 1) {
    sendControlledCue();
    const until = Date.now() + 3000;
    while (!report.controlledCue.acknowledgedAt && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    if (!report.controlledCue.acknowledgedAt) throw new Error('Controlled cue was not acknowledged.');
  }
  used.add(id);
  const clientAudioQuietMs = lastAudibleOutput ? Date.now() - lastAudibleOutput : null;
  report.turns.push({ turn: turn + 1, selected: id, inResponseTo: answer, inputStartMs: inputBytes / 48, clientAudioQuietMs });
  outputStart = spoken.length;
  clip = clips[id]; selectedClip = id; offset = 0; turn++; deciding = false;
}
const completed = new Promise(resolve => {
  deadline = setTimeout(() => { report.errors.push('Rehearsal deadline exceeded.'); close(); setTimeout(resolve, 10_000); }, maxSeconds * 1000);
  ws.addEventListener('open', () => send({ type: 'session.start', session: { ...session, audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } } } }));
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    const value = JSON.parse(event.data);
    if (value.type === 'session.thinking.appended' && value.client_event_id === report.controlledCue?.eventId) Object.assign(report.controlledCue, { acknowledgedAt: Date.now(), startMs: value.start_ms, endMs: value.end_ms });
    if (value.type === 'session.started') {
      report.providerSessionId = value.session?.id ?? null;
      // Same opening request as the production session owner.
      openingSentAt = Date.now();
      send({ type: 'session.instructions.append', event_id: 'opening', delegation_id: null, content: opening });
      if (producer) producerTimer = setInterval(() => producer.tick(), 500);
      inputStartedAt = Date.now();
      const pace = () => {
        report.maxInputLatenessMs = Math.max(report.maxInputLatenessMs, Date.now() - inputStartedAt - inputBytes / 48);
        let audio = Buffer.alloc(960);
        if (clip) {
          const range = pauseRanges[selectedClip];
          if (range && offset >= range[0] && offset < range[1] && !report.thoughtPauses.some(item => item.turn === turn)) {
            report.thoughtPauses.push({ turn, selected: selectedClip, plannedMs: (range[1] - range[0]) / 48, startedAt: Date.now(), audibleSamFrames: 0 });
          }
          audio = clip.subarray(offset, Math.min(offset + 960, clip.length)); offset += audio.length;
          if (offset >= clip.length) { clip = undefined; inputEnded = Date.now(); }
        }
        if (audible(audio)) lastAudibleInput = Date.now();
        send({ type: 'session.input_audio.append', audio: audio.toString('base64') });
        inputBytes += audio.length;
        const interruptOpening = approach === 'interruption' && turn === 0 && firstAudibleOutput > 0 && Date.now() - firstAudibleOutput >= 6000 && Date.now() - lastAudibleOutput < 250;
        const yielded = lastAudibleOutput > inputEnded && lastOutput > inputEnded && Date.now() - Math.max(lastOutput, lastAudibleOutput) > 2500 && Date.now() - inputEnded > 3000;
        let readyForReply = approach === 'interruption' && turn === 0 ? interruptOpening : yielded;
        if (readyForReply && !clip && !deciding && isInterview && turn < plan.turns && !finished() && !samSinceLastLine().includes('?')) {
          const quietMs = Date.now() - Math.max(lastOutput, lastAudibleOutput);
          readyForReply = quietMs > DEAD_AIR_MS;
          if (readyForReply) {
            report.deadAir.push({ afterTurn: turn, quietMs, sam: samSinceLastLine() });
          }
        }
        if (!clip && !deciding && readyForReply) void respond().catch(() => { report.errors.push('Rehearsal step failed.'); close(); });
        if (!closing) pacing = setTimeout(pace, Math.max(0, inputStartedAt + inputBytes / 48 - Date.now()));
      };
      pace();
    } else if (value.type === 'session.input_transcript.delta' || value.type === 'session.output_transcript.delta') {
      if (value.type === 'session.output_transcript.delta') {
        lastOutput = Date.now();
        if (plan.cueDuringSpeech && turn === 1 && !clip && !report.controlledCue) sendControlledCue();
      }
      const next = appendTranscript(report.transcript, { speaker: value.type === 'session.input_transcript.delta' ? 'trainee' : 'client', text: value.delta, startMs: value.start_ms, endMs: value.end_ms });
      const changed = next.find(entry => !report.transcript.includes(entry));
      report.transcript = next;
      if (changed) { passageUpdatedAt.set(changed.id, Date.now()); producer?.transcriptChanged(archivedTranscriptSchema.parse([changed])[0], next[next.indexOf(changed) - 1]?.id ?? null); }
    } else if (value.type === 'session.output_audio.delta') {
      const audio = Buffer.from(value.delta, 'base64');
      chunks.push(audio);
      // Live streams silence too. Wait for quiet PCM as well as settled text,
      // so a delayed transcript or deliberate pause does not trigger a reply.
      if (audible(audio)) {
        lastAudibleOutput = Date.now();
        if (!firstAudibleOutput) report.openingLatencyMs = lastAudibleOutput - openingSentAt;
        firstAudibleOutput ||= lastAudibleOutput;
        const range = pauseRanges[selectedClip];
        if (clip && range && offset >= range[0] && offset < range[1]) {
          const pause = report.thoughtPauses.find(item => item.turn === turn);
          if (pause) { pause.audibleSamFrames++; pause.firstSamAt ??= Date.now(); }
        }
      }
    } else if (value.type === 'session.instructions.appended' && value.client_event_id === 'opening') {
      report.openingAcknowledged = true;
    } else if (value.type === 'session.thinking.appended' || value.type === 'session.instructions.appended') {
      directions.providerEvent(value.client_event_id, true, { startMs: value.start_ms, endMs: value.end_ms });
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
        const replied = send({ type: 'session.thinking.append', event_id: eventId, delegation_id: value.delegation.id, content: NO_EXTERNAL_TASK });
        producer?.delegation(value.delegation.id, value.delegation.target, replied);
      }
    } else if (value.type === 'session.closed') {
      if (!closing) report.errors.push('Voice service closed before the rehearsal requested End.');
      report.finalized = true; report.usageSeconds = value.usage?.seconds ?? null; resolve();
    } else if (value.type === 'error') {
      report.providerErrors.push({ at: Date.now(), afterTurn: turn, closing, error: value.error });
      const eventId = value.error?.client_event_id;
      if (typeof eventId === 'string' && /^(cue|note)-/.test(eventId)) { directions.providerEvent(eventId, false); }
      else if (!(closing && value.error?.code === 'output_creation_failed')) report.errors.push({ code: value.error?.code ?? 'unknown', command: eventId ?? null });
    }
  });
  ws.addEventListener('error', () => { report.errors.push('Voice transport failed.'); close(); });
  ws.addEventListener('close', () => { if (!report.finalized) report.errors.push('Transport closed before finalization.'); resolve(); });
});
try {
  await completed;
  if (report.finalized && report.transcript.some(entry => entry.speaker === 'trainee')) {
    const common = { revision: report.transcript.length, apiKey: process.env.TYPESAFE_API_KEY, signal: AbortSignal.timeout(15_000) };
    report[isInterview ? 'interview' : 'trainee'] = isInterview
      ? await evaluateInterview({ ...common, planId: scenarioId, voiceId: clientId, transcript: archivedTranscriptSchema.parse(report.transcript) })
      : await evaluateTrainee({ ...common, scenarioId, clientId, transcript: report.transcript });
  }
} catch (error) { report.errors.push(`Final evaluation failed (${error.name}).`); }
finally {
  directions.close(); clearTimeout(deadline); clearInterval(producerTimer); clearTimeout(pacing); ws.close();
  await Promise.all(observations);
  if (producer) { await producer.settle(); report.producer = producer.summary(); }
  report.interventions = directions.records;
  report.turnGaps = interviewTurnGaps(report.transcript);
  if (report.thoughtPauses.some(item => item.audibleSamFrames > 0)) report.errors.push('Sam spoke during a participant thought pause.');
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
console.log(JSON.stringify({ output, briefDigest, finalized: report.finalized, turns: report.turns.map(item => item.selected), usageSeconds: report.usageSeconds, clientEnded: report.clientEnded, concern: report.trainee?.concern ?? null, directions: report.directions.map(({ afterTurn, signals, unavailable }) => ({ afterTurn, signals, unavailable })), scriptedDeadAir: report.deadAir.length, statementGaps: report.turnGaps.filter(item => !item.questionMark).length, questionWaits: report.turnGaps.filter(item => item.questionMark).length, maxInputLatenessMs: report.maxInputLatenessMs, errors: report.errors }));
if (!report.finalized || report.errors.length) process.exitCode = 1;
