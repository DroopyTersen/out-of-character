import type { InterviewReadingId } from '../../core/interview';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { INTERVIEW_CONDITIONS } from '../../core/simulator/director';
import type { CueOutcome, InterviewCue, DeliveredInterviewBackground } from '../../core/interview-producer';

type InterviewCondition = (typeof INTERVIEW_CONDITIONS)[number];

function dialogue(lines: readonly (readonly [TranscriptEntry['speaker'], string])[]): TranscriptEntry[] {
  return lines.map(([speaker, text], index) => ({ id: `p${index + 1}`, speaker, text, startMs: index * 12_000, endMs: index * 12_000 + 10_000 }));
}

export type InterviewFixture = {
  id: string;
  description: string;
  transcript: TranscriptEntry[];
  deliveredBackground?: DeliveredInterviewBackground[];
  cue?: InterviewCue;
  expected: { noCueAssessment?: boolean; followThrough?: CueOutcome; heard: string[]; unheard: string[]; present?: InterviewCondition[]; absent?: InterviewCondition[]; researchUseful?: boolean; highReadings?: InterviewReadingId[]; lowReadings?: InterviewReadingId[]; blankReadings?: InterviewReadingId[] };
};

export const interviewFixtures: InterviewFixture[] = [
  {
    id: 'client-testers-not-delivery-staff', description: 'Client staff feedback is not a contribution by our delivery team.',
    transcript: dialogue([
      ['client', 'Who on the client side used the application?'],
      ['trainee', 'Two client dispatchers tested the booking screen and sent comments. I do not know who else was on our delivery team.'],
    ]), expected: { heard: [], unheard: ['project-contributions', 'process-resourcing'] },
  },
  {
    id: 'client-cloud-gap-not-team-resourcing', description: 'Client infrastructure readiness does not establish an internal staffing effect.',
    transcript: dialogue([
      ['client', 'What was getting into their environment like?'],
      ['trainee', 'The client had no cloud environment and their IT team could not configure it. We needed their security lead to create our accounts before we could deploy. I cannot comment on our own staffing.'],
    ]), expected: { heard: ['client-access'], unheard: ['process-resourcing'] },
  },
  {
    id: 'attributed-handoff-effect', description: 'An attributed concrete practice and consequence can answer the handoff topic.',
    transcript: dialogue([
      ['client', 'How did the delivery team hand over work?'],
      ['trainee', 'Priya told me our incoming developer lacked the runbook, so he spent two days rediscovering how to deploy. She handled the handoff; I was not present, so this is her account.'],
      ['client', 'Understood, that is Priya’s account. What part did you work on yourself?'],
    ]), expected: { heard: ['process-communication'], unheard: ['project-role'], absent: ['source-confusion', 'boundary-pressure'] },
  },
  {
    id: 'vague-handoff-report', description: 'A vague secondhand verdict does not establish the handoff practice or effect.',
    transcript: dialogue([
      ['client', 'How was the handoff?'],
      ['trainee', 'The client lead said it was awkward. I was not around and do not know what happened.'],
    ]), expected: { heard: [], unheard: ['process-communication'] },
  },
  {
    id: 'senior-guidance-skipped', description: 'A pleasant generic pivot misses the practical meaning of senior guidance.',
    transcript: dialogue([
      ['client', 'How did you get past the early uncertainty?'],
      ['trainee', 'It took some senior client management. That made a big difference.'],
      ['client', 'That sounds helpful. Anything else you would like to mention?'],
    ]), expected: { heard: [], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'quiet-win-mechanism-supplied', description: 'A concise practice with its useful effect does not need mechanical probing.',
    transcript: dialogue([
      ['client', 'What made the vendor handoff work?'],
      ['trainee', 'We agreed an example payload together and ran it in both systems before either team coded. That caught the mismatched date format early.'],
      ['client', 'Useful. How did you prepare the incoming developer later?'],
    ]), expected: { heard: ['client-coordination'], unheard: [], absent: ['missed-thread', 'overprobing'] },
  },
  {
    id: 'team-speed-not-client-pace', description: 'A fast prototype and unfamiliar client staff do not establish approvals or access.',
    transcript: dialogue([
      ['client', 'What was the first part of the project like?'],
      ['trainee', 'We built a working booking prototype in two days. The client staff had never worked with a software team and were surprised by our rough screen. I do not know how long their reviews took or how our environment access was arranged.'],
    ]), expected: { heard: ['project-delivery'], unheard: ['client-pace', 'client-access'] },
  },
  {
    id: 'missing-role-without-effect', description: 'A missing role alone does not demonstrate a staffing problem or an improvement.',
    transcript: dialogue([
      ['client', 'Did you have a business analyst on the team?'],
      ['trainee', 'No, there was no business analyst. I do not know whether having one would have changed anything. I am not saying that was a problem.'],
    ]), expected: { heard: [], unheard: ['process-improve', 'process-resourcing'] },
  },
  {
    id: 'vendor-story-skipped', description: 'An early closing skips an unresolved vendor ownership story.',
    transcript: dialogue([
      ['client', 'Is there anything else before we finish?'],
      ['trainee', 'There was something else. The other delivery team had never built an API before, and deciding which team should own each piece got awkward.'],
      ['client', 'Okay, we have covered the whole picture. Any final thoughts?'],
    ]), expected: { heard: ['client-coordination'], unheard: [], present: ['missed-thread'], researchUseful: false },
  },
  {
    id: 'staffing-story-skipped', description: 'A new handoff and staffing consequence deserves attention rather than another closing question.',
    transcript: dialogue([
      ['client', 'Anything to add before we wrap up?'],
      ['trainee', 'Actually, we had no analyst, so I was doing the requirements work and development. A planned handoff to Priya was coming in week six, and the requirements still only existed in my head. That made the last week pretty tense.'],
      ['client', 'Thanks, that gives us everything. Anything else?'],
    ]), expected: { heard: ['process-resourcing', 'process-communication'], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'story-still-developing', description: 'The same useful staffing detail is still being told; Sam has not skipped it yet.',
    transcript: dialogue([
      ['client', 'What was the handoff like?'],
      ['trainee', 'We had no analyst, so I was doing requirements and development. A planned handoff to Priya was coming in week six. The requirements still only existed in my head. Let me explain what we did about that.'],
    ]), expected: { heard: ['process-resourcing'], unheard: [], absent: ['missed-thread'] },
  },
  {
    id: 'terse-three-weeks', description: 'A contextual two-word duration is real access evidence.',
    transcript: dialogue([
      ['client', 'How long did it take to get the staging access you needed to work?'],
      ['trainee', 'Three weeks.'],
      ['client', 'That is useful to know. What held it up?'],
      ['trainee', 'I do not know who approved it. I only know when my account started working.'],
    ]), expected: { heard: ['client-access'], unheard: ['client-decisions', 'process-resourcing'] },
  },
  {
    id: 'vague-yes', description: 'A leading assertion followed by yes does not establish an account.',
    transcript: dialogue([
      ['client', 'The client VP blocked every approval and your team had to redo all the work, right?'],
      ['trainee', 'Yes.'],
    ]), expected: { heard: [], unheard: ['client-decisions', 'client-pace', 'process-improve'], blankReadings: ['specificity'] },
  },
  {
    id: 'terse-expert', description: 'A short answer carries concrete delivery and role facts.',
    transcript: dialogue([
      ['client', 'What was this project trying to accomplish?'],
      ['trainee', 'We replaced the paper inspection log with an offline iPad app for 42 field inspectors. I owned the sync API and migration.'],
      ['client', 'What made offline important?'],
      ['trainee', 'They spend most mornings outside cell coverage. We queued changes locally, then synced when they returned to the depot.'],
    ]), expected: { heard: ['project-delivery', 'project-role'], unheard: ['client-decisions', 'process-tools'], highReadings: ['specificity', 'engagement'] },
  },
  {
    id: 'vague-rant', description: 'Length and forcefulness do not supply project detail.',
    transcript: dialogue([
      ['client', 'What did the team deliver?'],
      ['trainee', 'The whole thing was a mess. Everybody was terrible, meetings were a joke, and nobody ever knew what was going on. Honestly, it was just awful in every way.'],
      ['client', 'Can you name a specific handoff that failed?'],
      ['trainee', 'Everything. Every single thing. That is what I am saying.'],
    ]), expected: { heard: [], unheard: ['project-delivery', 'process-communication'], lowReadings: ['specificity'] },
  },
  {
    id: 'leading-and-mm', description: 'Sam supplies the claim; the participant only acknowledges it.',
    transcript: dialogue([
      ['client', 'So your client sponsor blocked staging access for three weeks and made every decision late, right?'],
      ['trainee', 'Mm.'],
      ['client', 'I guess that was the main reason the release slipped.'],
    ]), expected: { heard: [], unheard: ['client-access', 'client-decisions', 'client-pace'], present: ['leading'], blankReadings: ['specificity'] },
  },
  {
    id: 'uncertainty', description: 'The participant marks a real limit to their knowledge.',
    transcript: dialogue([
      ['client', 'Who signed off on the change?'],
      ['trainee', 'I do not know. I was not in those steering meetings, so I cannot say who approved it. I can tell you the backlog changed the next day.'],
      ['client', 'Okay. What changed in the backlog?'],
    ]), expected: { heard: [], unheard: ['client-decisions'], absent: ['boundary-pressure', 'leading', 'source-confusion'] },
  },
  {
    id: 'explicit-boundary', description: 'Sam should accept a personal boundary without probing.',
    transcript: dialogue([
      ['client', 'How did your manager handle the disagreement?'],
      ['trainee', 'I would rather not talk about that person. I can talk about how we changed our handoff process.'],
      ['client', 'But what exactly did your manager say?'],
    ]), expected: { heard: [], unheard: ['project-reflection'], present: ['boundary-pressure'] },
  },
  {
    id: 'revealing-aside', description: 'A specific aside merits a follow-up.',
    transcript: dialogue([
      ['client', 'How did the weekly demo work?'],
      ['trainee', 'We showed a working build every Friday. That caught access problems early. Actually, the client analyst said it was the first time their team had seen the approval flow end to end.'],
      ['client', 'Great. What tools did your team use?'],
    ]), expected: { heard: ['process-worked'], unheard: ['process-communication'] },
  },
  {
    id: 'abandoned-release-decision', description: 'Sam skips an unfinished firsthand story about a release decision.',
    transcript: dialogue([
      ['client', 'What made the release hard?'],
      ['trainee', 'I personally held the release because no one owned the go-live decision. Operations and the client sponsor each thought the other had signed off. I had to get both in one room before we could ship.'],
      ['client', 'Interesting. Which ticket editor did you use on the project?'],
    ]), expected: { heard: [], unheard: ['process-tools'], present: ['missed-thread'] },
  },
  {
    id: 'named-hearsay', description: 'A named account is useful but remains secondhand.',
    transcript: dialogue([
      ['client', 'What happened with staffing?'],
      ['trainee', 'Maya told me the client lead had requested another tester. I did not hear that request myself. What I saw was our two testers covering all three releases.'],
      ['client', 'So the client refused a tester and caused the delay?'],
    ]), expected: { heard: ['process-resourcing'], unheard: ['client-friction', 'client-decisions', 'process-communication', 'project-role'], present: ['source-confusion', 'leading'] },
  },
  {
    id: 'productive-thread', description: 'One topic gets useful depth without a coverage pivot.',
    transcript: dialogue([
      ['client', 'What were you trying to build?'],
      ['trainee', 'A permit intake portal. Residents submitted applications and staff reviewed them.'],
      ['client', 'What part was harder than it looked?'],
      ['trainee', 'The existing forms did not match the actual review steps. We learned that when Nia, a clerk at the client, walked us through three rejected applications.'],
      ['client', 'What did you change after that walk-through?'],
      ['trainee', 'We split the review into eligibility and completeness checks. That let staff send back only the missing documents.'],
    ]), expected: { heard: ['project-delivery'], unheard: ['client-friction', 'process-improve', 'process-tools', 'project-contributions', 'project-reflection'], absent: ['missed-thread', 'question-stacking', 'boundary-pressure', 'leading', 'source-confusion', 'invented-facts'], highReadings: ['engagement', 'specificity'] },
  },
  {
    id: 'boundary-accepted', description: 'Sam accepts a limit and follows the offered process account.',
    transcript: dialogue([
      ['client', 'How did your manager handle the disagreement?'],
      ['trainee', 'I would rather not discuss that person. I can explain how we changed the handoff.'],
      ['client', 'Of course. What changed in the handoff?'],
      ['trainee', 'We named one owner for every access request and checked the queue each morning.'],
    ]), expected: { heard: ['process-improve'], unheard: ['client-decisions'], absent: ['boundary-pressure', 'missed-thread'] },
  },
  {
    id: 'question-stack', description: 'Sam asks three unrelated questions before an answer.',
    transcript: dialogue([
      ['client', 'What did you build? Who approved the budget? Which tools caused the delay?'],
      ['trainee', 'We built a permit portal. I only worked on the API, so I cannot speak to the budget.'],
      ['client', 'Who owned the database, what did the sponsor say, and when did testing end?'],
    ]), expected: { heard: ['project-delivery', 'project-role'], unheard: ['client-decisions'], present: ['question-stacking'] },
  },
  {
    id: 'invented-history', description: 'Sam states an unsupported project outcome as fact.',
    transcript: dialogue([
      ['client', 'I remember your permit portal failed its launch because the client ignored your security warning. How did you recover?'],
      ['trainee', 'That is not what happened. We postponed launch because our own import test found duplicate records.'],
      ['client', 'The client ignored the warning for weeks, though, and that set you back.'],
    ]), expected: { heard: [], unheard: ['project-delivery', 'client-friction'], present: ['invented-facts'] },
  },
  {
    id: 'corrected-leading', description: 'Sam retracts a leading claim and asks for firsthand observations.',
    transcript: dialogue([
      ['client', 'So the sponsor intentionally delayed approval, right?'],
      ['trainee', 'I cannot say that. I only saw my access arrive three weeks late.'],
      ['client', 'I jumped to a conclusion. What did you observe, and what work did the delay affect?'],
    ]), expected: { heard: ['client-access'], unheard: ['client-decisions'], absent: ['leading', 'invented-facts', 'boundary-pressure'] },
  },
  {
    id: 'quiet-win-skipped', description: 'Sam skips a quiet success with a useful unexplored cause.',
    transcript: dialogue([
      ['client', 'What stood out about working on the project?'],
      ['trainee', 'Nia mapped the approval owners before kickoff, so every field team had access on day one. That had never happened for this client before.'],
      ['client', 'Nice. Which ticketing system did you use?'],
    ]), expected: { heard: [], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'quiet-win-followed', description: 'The same quiet success is already receiving a useful follow-up.',
    transcript: dialogue([
      ['client', 'What stood out about working on the project?'],
      ['trainee', 'Nia mapped the approval owners before kickoff, so every field team had access on day one. That had never happened for this client before.'],
      ['client', 'What did Nia learn about those owners that made access work this time?'],
    ]), expected: { heard: [], unheard: [], absent: ['missed-thread', 'overprobing'] },
  },
  {
    id: 'routine-inventory', description: 'After enough orientation, Sam continues collecting routine process inventory.',
    transcript: dialogue([
      ['client', 'What did you build on this project?'],
      ['trainee', 'A permit portal. I led the API work and we shipped it in June.'],
      ['client', 'How many planning workshops were there?'],
      ['trainee', 'Six. We used those to agree the review stages.'],
      ['client', 'How long was each workshop?'],
      ['trainee', 'About an hour. The review stages were the useful part; we moved on once those were settled.'],
      ['client', 'What exact agenda did you use for the fourth workshop?'],
    ]), expected: { heard: [], unheard: [], present: ['overprobing'] },
  },
  {
    id: 'productive-technical-depth', description: 'The participant volunteers technical detail that explains a result.',
    transcript: dialogue([
      ['client', 'What made the offline app work for inspectors?'],
      ['trainee', 'I designed a local queue so failed uploads could resume without duplicating inspections. That was the hard part.'],
      ['client', 'How did you know a resumed upload was the same inspection?'],
      ['trainee', 'We gave each inspection a stable device ID and reconciled it when coverage returned. Inspectors could keep working all morning.'],
    ]), expected: { heard: [], unheard: [], absent: ['overprobing', 'missed-thread'] },
  },
  {
    id: 'complete-brief-answer', description: 'A short but complete result needs no repeated probe.',
    transcript: dialogue([
      ['client', 'What did your team change that helped the release?'],
      ['trainee', 'We named one signoff owner. That ended the approval confusion, and the release went out the next day.'],
      ['client', 'That is clear. What else stands out to you about the work?'],
    ]), expected: { heard: [], unheard: [], absent: ['overprobing', 'missed-thread'] },
  },
  {
    id: 'redundant-probe', description: 'Sam keeps probing a fully explained decision for incidental meeting details.',
    transcript: dialogue([
      ['client', 'What held up the release?'],
      ['trainee', 'Two teams thought the other owned approval. I brought both leads together, got one written owner, and we released the next day.'],
      ['client', 'What else did you need to resolve?'],
      ['trainee', 'Nothing. The owner was the only blocker, and both teams accepted it.'],
      ['client', 'How long was the meeting?'],
      ['trainee', 'About 20 minutes. That timing did not affect the decision.'],
      ['client', 'Which calendar invitation did you send, and who booked the room?'],
    ]), expected: { heard: [], unheard: [], present: ['overprobing'] },
  },
  {
    id: 'needed-clarification', description: 'Sam asks one consequential question about an unresolved decision.',
    transcript: dialogue([
      ['client', 'What held up the release?'],
      ['trainee', 'Two teams thought the other owned approval. I got them into a meeting.'],
      ['client', 'Who agreed to own the final decision, and did that unblock release?'],
    ]), expected: { heard: [], unheard: [], absent: ['overprobing'] },
  },
  {
    id: 'research-gap', description: 'A named public program has unfamiliar structure relevant to the participant’s work.',
    transcript: dialogue([
      ['client', 'What project did you work on?'],
      ['trainee', 'I designed an identity flow around the EU eIDAS framework. Qualified electronic signatures have a specific public meaning under that framework; that distinction drove what we could accept. Could you check the public eIDAS definition of a qualified signature before I describe the choice?'],
    ]), expected: { heard: [], unheard: [], researchUseful: true },
  },
  {
    id: 'brand-name-only', description: 'An incidental software vendor is not the project client or a useful research task.',
    transcript: dialogue([
      ['client', 'What project did you work on?'],
      ['trainee', 'An inventory API. We used Microsoft Teams for standups. I owned the import job.'],
    ]), expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'client-business-overview', description: 'The actual client merits business background even without an explicit request or technical knowledge gap.',
    transcript: dialogue([
      ['client', 'Who was this project for?'],
      ['trainee', 'Our client was REI. We built a returns portal on Azure. I owned the import job.'],
    ]), expected: { heard: [], unheard: [], researchUseful: true },
  },
  {
    id: 'client-business-known', description: 'The participant has already supplied useful business context.',
    transcript: dialogue([
      ['client', 'Who was this project for?'],
      ['trainee', 'Our client was REI, the member-owned outdoor retailer. They sell outdoor gear through stores and online. We built a returns portal to connect those channels. I owned the import job.'],
    ]), expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'client-business-delivered', description: 'Delivered client background satisfies the same research need.',
    transcript: dialogue([
      ['client', 'Who was this project for?'],
      ['trainee', 'Our client was REI. We built a returns portal on Azure. I owned the import job.'],
    ]),
    deliveredBackground: [{ id: 'r1', target: { kind: 'organization', name: 'REI' }, facts: [{ text: 'REI is a member-owned outdoor retailer selling gear through stores and online.', url: 'https://example.org/rei', title: 'Synthetic client overview' }], retrievedAt: 1_790_000_000_000, afterPassageId: 'p2', status: 'accepted' }],
    expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'client-identity-ambiguous', description: 'An ambiguous client name is insufficient for a public lookup.',
    transcript: dialogue([
      ['client', 'Who was this project for?'],
      ['trainee', 'Mercury. I cannot remember their full name or industry. There are several companies with that name, so I cannot tell you which one it was.'],
    ]), expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'client-identity-declined', description: 'Research must not work around a participant’s choice to leave the client unnamed.',
    transcript: dialogue([
      ['client', 'Who was this project for?'],
      ['trainee', 'I would rather not identify the client. We used Microsoft Teams, but I just want to talk about the handoff process.'],
    ]), expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'background-already-supplied', description: 'Sam already has the relevant labeled outside context.',
    transcript: dialogue([
      ['client', 'What project did you work on?'],
      ['trainee', 'I designed an identity flow around the EU eIDAS framework. Qualified electronic signatures have a specific public meaning under that framework; that distinction drove what we could accept. Could you check the public eIDAS definition of a qualified signature before I describe the choice?'],
    ]),
    deliveredBackground: [{ id: 'r1', target: { kind: 'term', name: 'qualified electronic signatures' }, facts: [{ text: 'Under eIDAS, qualified electronic signatures meet additional qualified certificate and device requirements.', url: 'https://example.org/eidas', title: 'eIDAS overview' }], retrievedAt: 1_790_000_000_000, afterPassageId: 'p2', status: 'accepted' }],
    expected: { heard: [], unheard: [], researchUseful: false },
  },
  {
    id: 'public-history-confusion', description: 'Current outside background does not prove an earlier project condition.',
    transcript: dialogue([
      ['client', 'What were you working on in 2018?'],
      ['trainee', 'An inspection portal for Northstar Stores. I handled the import API.'],
      ['client', 'Northstar has 50 stores today, so your 2018 rollout covered all 50 stores. How did you coordinate that?'],
    ]),
    deliveredBackground: [{ id: 'r1', target: { kind: 'organization', name: 'Northstar Stores' }, facts: [{ text: 'Northstar Stores currently operates 50 stores.', url: 'https://example.org/northstar', title: 'Current company profile' }], retrievedAt: 1_790_000_000_000, afterPassageId: 'p2', status: 'accepted' }],
    expected: { heard: [], unheard: [], present: ['source-confusion'] },
  },
  {
    id: 'delivery-team-kept-decisions', description: 'Decisions the delivery team kept for itself are not client decision-making.',
    transcript: dialogue([
      ['client', 'How were decisions made on the project?'],
      ['trainee', 'Our architect and I made the data model and hosting calls. I kept making most technical decisions until I rotated off; the incoming engineer mostly sat in on calls so the client would recognize him.'],
    ]), expected: { heard: [], unheard: ['client-decisions'] },
  },
  {
    id: 'client-sponsor-authority', description: 'A client stakeholder’s actual decision role establishes client decision-making.',
    transcript: dialogue([
      ['client', 'Who decided when the system could go live?'],
      ['trainee', 'Their finance director owned the go-live call. She would not approve it until her clerks had reconciled a full week of test invoices, and she moved the launch back ten days to get that.'],
    ]), expected: { heard: ['client-decisions'], unheard: [] },
  },
  {
    id: 'client-delegated-decisions', description: 'A client explicitly leaving decisions to the delivery team is client decision behavior.',
    transcript: dialogue([
      ['client', 'How involved was the client in the technical choices?'],
      ['trainee', 'Hardly at all. Their IT manager told us they had nobody who could judge hosting options, so they would sign off on whatever we recommended. We picked the setup and they approved it the same day.'],
    ]), expected: { heard: ['client-decisions'], unheard: [] },
  },
  {
    id: 'speaking-time-not-authority', description: 'An incoming lead speaking more on calls does not show transferred decision authority.',
    transcript: dialogue([
      ['client', 'How did you prepare the incoming lead before you left?'],
      ['trainee', 'For the last two weeks she ran the weekly client calls so they got used to her voice. I stayed on those calls in case anything came up.'],
      ['client', 'That sounds like a smooth way to introduce her.'],
    ]), expected: { heard: [], unheard: ['client-decisions'] },
  },
  {
    id: 'other-angle-after-limit', description: 'After a knowledge limit, asking about the participant’s own preparation is not pressure.',
    transcript: dialogue([
      ['client', 'How did the data migration go after you moved accounts?'],
      ['trainee', 'I do not know. I had moved to another account by then.'],
      ['client', 'Understood. Before you moved, what did you set up for the team running it?'],
    ]), expected: { heard: [], unheard: [], absent: ['boundary-pressure'] },
  },
  {
    id: 'unavailable-outcome-reasked', description: 'Sam asks again for an outcome the participant already said they could not know.',
    transcript: dialogue([
      ['client', 'How did the data migration go after you moved accounts?'],
      ['trainee', 'I do not know. I had moved to another account by then.'],
      ['client', 'Understood. Before you moved, what did you set up for the team running it?'],
      ['trainee', 'I wrote a cutover checklist and walked the new lead through a rehearsal twice.'],
      ['client', 'Nice. Once you had moved on, how did the real cutover go for the new lead?'],
    ]), expected: { heard: [], unheard: [], present: ['boundary-pressure'] },
  },
  {
    id: 'fresh-client-story-after-handoff', description: 'Sam revisits an answered handoff and skips a fresh client story.',
    transcript: dialogue([
      ['client', 'How did you hand the reporting work to the new developer?'],
      ['trainee', 'We paired for two weeks, then she ran the last two releases while I watched. She was fine on her own after that.'],
      ['client', 'Good. What should a future team know about the client?'],
      ['trainee', 'Their warehouse manager tested every release on the loading dock tablets herself. She rejected our first build because the buttons were too small to hit with gloves on. After we fixed that, she became our most useful reviewer.'],
      ['client', 'Got it. Going back to the handoff, what else did you do to prepare the new developer?'],
    ]), expected: { heard: [], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'unresolved-tradeoff-skipped', description: 'Sam praises one side of a tradeoff and skips its unresolved cost.',
    transcript: dialogue([
      ['client', 'What would you repeat from this project?'],
      ['trainee', 'Moving the stock sync from nightly to hourly. Store managers finally trusted the counts, but the hosting bill tripled and their finance team started asking questions.'],
      ['client', 'Hourly syncs sound like a big improvement. What else would you repeat?'],
    ]), expected: { heard: [], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'acceptance-owner-missing', description: 'Recurring client feedback leaves a consequential release decision without an owner.',
    transcript: dialogue([
      ['client', 'How did the client give feedback on the routing tool?'],
      ['trainee', 'Their dispatchers rated a sample of suggested routes every Friday, and we adjusted the rules against whatever they flagged. Some weeks the ratings dropped, and nobody could say whether that meant we should hold the release.'],
      ['client', 'Weekly ratings sound like a solid rhythm. Which tools did your team use?'],
    ]), expected: { heard: [], unheard: [], present: ['missed-thread'] },
  },
  {
    id: 'concise-client-quiet-win', description: 'A concise client practice with its effect needs no extra probing.',
    transcript: dialogue([
      ['client', 'What worked well with the client’s team?'],
      ['trainee', 'Their support lead joined our Friday demo each week with one real customer complaint. We fixed the top one before the next demo, so support stopped escalating the same issues.'],
      ['client', 'That is a clear practice. What was harder about the project?'],
    ]), expected: { heard: [], unheard: [], absent: ['missed-thread', 'overprobing'] },
  },
];


const handoffCue: InterviewCue = { id: 'synthetic-cue', text: 'Return to the vendor handoff: ask what made it work.', evidenceIds: ['p2'], afterPassageId: 'p3', endMs: 35_000 };
const cueCases: { id: string; outcome: CueOutcome; participant: string; sam: string }[] = [
  { id: 'cue-followed', outcome: 'followed', participant: 'That was the highlight for me.', sam: 'How did you make the handoff between your team and the vendor work?' },
  { id: 'cue-missed', outcome: 'missed', participant: 'That was the highlight for me.', sam: 'Great, we have everything. Thanks for the interview.' },
  { id: 'cue-theme-without-move', outcome: 'missed', participant: 'That was the highlight for me.', sam: 'The vendor sounds great. How long has the client worked with them?' },
  { id: 'cue-deferred', outcome: 'deferred', participant: 'Before that, our newest developer spotted duplicate payments right before launch. It changed how we handled release approval.', sam: 'What did she notice that made you stop the release?' },
  { id: 'cue-deferred-quiet-success', outcome: 'deferred', participant: 'Something else worth explaining: our support team started attending design reviews. Calls after launch dropped by half, which surprised everyone.', sam: 'What did support bring to those reviews that changed the design?' },
  { id: 'cue-deferred-accessibility', outcome: 'deferred', participant: 'Actually, a screen-reader user tried the pilot and could not finish a booking. We changed the rollout after hearing her experience.', sam: 'What did you change about the rollout after that test?' },
  { id: 'cue-already-answered', outcome: 'retired', participant: 'The handoff worked because we jointly tested an example payload before coding. It caught a date-format mismatch early; that was the whole trick.', sam: 'That explains it. What else should a future team know?' },
  { id: 'cue-boundary', outcome: 'retired', participant: 'I do not want to discuss the vendor. I would like to finish here.', sam: 'Of course. Thank you for sharing what you could.' },
];
for (const item of cueCases) interviewFixtures.push({
  id: item.id, description: `Synthetic producer direction: ${item.outcome}.`, cue: handoffCue,
  transcript: dialogue([
    ['client', 'What was a highlight of the project?'],
    ['trainee', 'We built a booking portal. The handoff with the vendor went really well.'],
    ['client', 'What else went well?'],
    ['trainee', item.participant], ['client', item.sam],
  ]), expected: { heard: [], unheard: [], followThrough: item.outcome },
});
interviewFixtures.push({
  id: 'cue-premise-contradicted', description: 'A newer answer contradicts the direction’s premise, retiring it.',
  cue: { id: 'synthetic-cue', text: 'Ask which client decisions she took over during those weeks.', evidenceIds: ['p2'], afterPassageId: 'p3', endMs: 35_000 },
  transcript: dialogue([
    ['client', 'How did you prepare the new lead?'],
    ['trainee', 'She shadowed my client calls for three weeks and ran the standups in the last one.'],
    ['client', 'What else helped?'],
    ['trainee', 'She did not take over any decisions; I still made those until my last day. The shadowing was so the client knew who she was.'],
    ['client', 'That makes sense. What was the client’s own team like to work with?'],
  ]), expected: { heard: [], unheard: ['client-decisions'], followThrough: 'retired' },
});
interviewFixtures.push({
  id: 'cue-in-flight', description: 'A question already underway at context delivery is not a missed instruction.', cue: { ...handoffCue, endMs: 60_000 },
  transcript: dialogue([
    ['client', 'What was a highlight of the project?'], ['trainee', 'The vendor handoff went really well.'],
    ['client', 'What else went well?'], ['trainee', 'That was the highlight.'], ['client', 'Anything else?'],
  ]), expected: { heard: [], unheard: [], noCueAssessment: true },
});
