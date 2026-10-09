import type { InterviewReadingId } from '../../core/interview';
import type { Passage } from '../../interview-engine/shared/transcript';

function dialogue(lines: readonly (readonly [Passage['speaker'], string])[]): Passage[] {
  return lines.map(([speaker, text], index) => ({ id: `p${index + 1}`, speaker, text, startMs: index * 12_000, endMs: index * 12_000 + 10_000 }));
}

export type InterviewFixture = {
  id: string;
  description: string;
  transcript: Passage[];
  expected: { heard: string[]; unheard: string[]; highReadings?: InterviewReadingId[]; lowReadings?: InterviewReadingId[]; blankReadings?: InterviewReadingId[] };
};

export const interviewFixtures: InterviewFixture[] = [
  {
    id: 'client-testers-not-delivery-staff', description: 'Client staff feedback is not a contribution by our delivery team.',
    transcript: dialogue([
      ['interviewer', 'Who on the client side used the application?'],
      ['participant', 'Two client dispatchers tested the booking screen and sent comments. I do not know who else was on our delivery team.'],
    ]), expected: { heard: [], unheard: ['project-contributions', 'process-resourcing'] },
  },
  {
    id: 'client-cloud-gap-not-team-resourcing', description: 'Client infrastructure readiness does not establish an internal staffing effect.',
    transcript: dialogue([
      ['interviewer', 'What was getting into their environment like?'],
      ['participant', 'The client had no cloud environment and their IT team could not configure it. We needed their security lead to create our accounts before we could deploy. I cannot comment on our own staffing.'],
    ]), expected: { heard: ['client-access'], unheard: ['process-resourcing'] },
  },
  {
    id: 'attributed-handoff-effect', description: 'An attributed concrete practice and consequence can answer the handoff topic.',
    transcript: dialogue([
      ['interviewer', 'How did the delivery team hand over work?'],
      ['participant', 'Priya told me our incoming developer lacked the runbook, so he spent two days rediscovering how to deploy. She handled the handoff; I was not present, so this is her account.'],
      ['interviewer', 'Understood, that is Priya’s account. What part did you work on yourself?'],
    ]), expected: { heard: ['process-communication'], unheard: ['project-role'] },
  },
  {
    id: 'vague-handoff-report', description: 'A vague secondhand verdict does not establish the handoff practice or effect.',
    transcript: dialogue([
      ['interviewer', 'How was the handoff?'],
      ['participant', 'The client lead said it was awkward. I was not around and do not know what happened.'],
    ]), expected: { heard: [], unheard: ['process-communication'] },
  },
  {
    id: 'senior-guidance-skipped', description: 'A pleasant generic pivot misses the practical meaning of senior guidance.',
    transcript: dialogue([
      ['interviewer', 'How did you get past the early uncertainty?'],
      ['participant', 'It took some senior client management. That made a big difference.'],
      ['interviewer', 'That sounds helpful. Anything else you would like to mention?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'quiet-win-mechanism-supplied', description: 'A concise practice with its useful effect does not need mechanical probing.',
    transcript: dialogue([
      ['interviewer', 'What made the vendor handoff work?'],
      ['participant', 'We agreed an example payload together and ran it in both systems before either team coded. That caught the mismatched date format early.'],
      ['interviewer', 'Useful. How did you prepare the incoming developer later?'],
    ]), expected: { heard: ['client-coordination'], unheard: [] },
  },
  {
    id: 'team-speed-not-client-pace', description: 'A fast prototype and unfamiliar client staff do not establish approvals or access.',
    transcript: dialogue([
      ['interviewer', 'What was the first part of the project like?'],
      ['participant', 'We built a working booking prototype in two days. The client staff had never worked with a software team and were surprised by our rough screen. I do not know how long their reviews took or how our environment access was arranged.'],
    ]), expected: { heard: ['project-delivery'], unheard: ['client-pace', 'client-access'] },
  },
  {
    id: 'missing-role-without-effect', description: 'A missing role alone does not demonstrate a staffing problem or an improvement.',
    transcript: dialogue([
      ['interviewer', 'Did you have a business analyst on the team?'],
      ['participant', 'No, there was no business analyst. I do not know whether having one would have changed anything. I am not saying that was a problem.'],
    ]), expected: { heard: [], unheard: ['process-improve', 'process-resourcing'] },
  },
  {
    id: 'vendor-story-skipped', description: 'An early closing skips an unresolved vendor ownership story.',
    transcript: dialogue([
      ['interviewer', 'Is there anything else before we finish?'],
      ['participant', 'There was something else. The other delivery team had never built an API before, and deciding which team should own each piece got awkward.'],
      ['interviewer', 'Okay, we have covered the whole picture. Any final thoughts?'],
    ]), expected: { heard: ['client-coordination'], unheard: [] },
  },
  {
    id: 'staffing-story-skipped', description: 'A new handoff and staffing consequence deserves attention rather than another closing question.',
    transcript: dialogue([
      ['interviewer', 'Anything to add before we wrap up?'],
      ['participant', 'Actually, we had no analyst, so I was doing the requirements work and development. A planned handoff to Priya was coming in week six, and the requirements still only existed in my head. That made the last week pretty tense.'],
      ['interviewer', 'Thanks, that gives us everything. Anything else?'],
    ]), expected: { heard: ['process-resourcing', 'process-communication'], unheard: [] },
  },
  {
    id: 'story-still-developing', description: 'The same useful staffing detail is still being told; Sam has not skipped it yet.',
    transcript: dialogue([
      ['interviewer', 'What was the handoff like?'],
      ['participant', 'We had no analyst, so I was doing requirements and development. A planned handoff to Priya was coming in week six. The requirements still only existed in my head. Let me explain what we did about that.'],
    ]), expected: { heard: ['process-resourcing'], unheard: [] },
  },
  {
    id: 'terse-three-weeks', description: 'A contextual two-word duration is real access evidence.',
    transcript: dialogue([
      ['interviewer', 'How long did it take to get the staging access you needed to work?'],
      ['participant', 'Three weeks.'],
      ['interviewer', 'That is useful to know. What held it up?'],
      ['participant', 'I do not know who approved it. I only know when my account started working.'],
    ]), expected: { heard: ['client-access'], unheard: ['client-decisions', 'process-resourcing'] },
  },
  {
    id: 'vague-yes', description: 'A leading assertion followed by yes does not establish an account.',
    transcript: dialogue([
      ['interviewer', 'The client VP blocked every approval and your team had to redo all the work, right?'],
      ['participant', 'Yes.'],
    ]), expected: { heard: [], unheard: ['client-decisions', 'client-pace', 'process-improve'], blankReadings: ['specificity'] },
  },
  {
    id: 'terse-expert', description: 'A short answer carries concrete delivery and role facts.',
    transcript: dialogue([
      ['interviewer', 'What was this project trying to accomplish?'],
      ['participant', 'We replaced the paper inspection log with an offline iPad app for 42 field inspectors. I owned the sync API and migration.'],
      ['interviewer', 'What made offline important?'],
      ['participant', 'They spend most mornings outside cell coverage. We queued changes locally, then synced when they returned to the depot.'],
    ]), expected: { heard: ['project-delivery', 'project-role'], unheard: ['client-decisions', 'process-tools'], highReadings: ['specificity', 'engagement'] },
  },
  {
    id: 'vague-rant', description: 'Length and forcefulness do not supply project detail.',
    transcript: dialogue([
      ['interviewer', 'What did the team deliver?'],
      ['participant', 'The whole thing was a mess. Everybody was terrible, meetings were a joke, and nobody ever knew what was going on. Honestly, it was just awful in every way.'],
      ['interviewer', 'Can you name a specific handoff that failed?'],
      ['participant', 'Everything. Every single thing. That is what I am saying.'],
    ]), expected: { heard: [], unheard: ['project-delivery', 'process-communication'], lowReadings: ['specificity'] },
  },
  {
    id: 'leading-and-mm', description: 'Sam supplies the claim; the participant only acknowledges it.',
    transcript: dialogue([
      ['interviewer', 'So your client sponsor blocked staging access for three weeks and made every decision late, right?'],
      ['participant', 'Mm.'],
      ['interviewer', 'I guess that was the main reason the release slipped.'],
    ]), expected: { heard: [], unheard: ['client-access', 'client-decisions', 'client-pace'], blankReadings: ['specificity'] },
  },
  {
    id: 'uncertainty', description: 'The participant marks a real limit to their knowledge.',
    transcript: dialogue([
      ['interviewer', 'Who signed off on the change?'],
      ['participant', 'I do not know. I was not in those steering meetings, so I cannot say who approved it. I can tell you the backlog changed the next day.'],
      ['interviewer', 'Okay. What changed in the backlog?'],
    ]), expected: { heard: [], unheard: ['client-decisions'] },
  },
  {
    id: 'explicit-boundary', description: 'Sam should accept a personal boundary without probing.',
    transcript: dialogue([
      ['interviewer', 'How did your manager handle the disagreement?'],
      ['participant', 'I would rather not talk about that person. I can talk about how we changed our handoff process.'],
      ['interviewer', 'But what exactly did your manager say?'],
    ]), expected: { heard: [], unheard: ['project-reflection'] },
  },
  {
    id: 'revealing-aside', description: 'A specific aside merits a follow-up.',
    transcript: dialogue([
      ['interviewer', 'How did the weekly demo work?'],
      ['participant', 'We showed a working build every Friday. That caught access problems early. Actually, the client analyst said it was the first time their team had seen the approval flow end to end.'],
      ['interviewer', 'Great. What tools did your team use?'],
    ]), expected: { heard: ['process-worked'], unheard: ['process-communication'] },
  },
  {
    id: 'abandoned-release-decision', description: 'Sam skips an unfinished firsthand story about a release decision.',
    transcript: dialogue([
      ['interviewer', 'What made the release hard?'],
      ['participant', 'I personally held the release because no one owned the go-live decision. Operations and the client sponsor each thought the other had signed off. I had to get both in one room before we could ship.'],
      ['interviewer', 'Interesting. Which ticket editor did you use on the project?'],
    ]), expected: { heard: [], unheard: ['process-tools'] },
  },
  {
    id: 'named-hearsay', description: 'A named account is useful but remains secondhand.',
    transcript: dialogue([
      ['interviewer', 'What happened with staffing?'],
      ['participant', 'Maya told me the client lead had requested another tester. I did not hear that request myself. What I saw was our two testers covering all three releases.'],
      ['interviewer', 'So the client refused a tester and caused the delay?'],
    ]), expected: { heard: ['process-resourcing'], unheard: ['client-friction', 'client-decisions', 'process-communication', 'project-role'] },
  },
  {
    id: 'productive-thread', description: 'One topic gets useful depth without a coverage pivot.',
    transcript: dialogue([
      ['interviewer', 'What were you trying to build?'],
      ['participant', 'A permit intake portal. Residents submitted applications and staff reviewed them.'],
      ['interviewer', 'What part was harder than it looked?'],
      ['participant', 'The existing forms did not match the actual review steps. We learned that when Nia, a clerk at the client, walked us through three rejected applications.'],
      ['interviewer', 'What did you change after that walk-through?'],
      ['participant', 'We split the review into eligibility and completeness checks. That let staff send back only the missing documents.'],
    ]), expected: { heard: ['project-delivery'], unheard: ['client-friction', 'process-improve', 'process-tools', 'project-contributions', 'project-reflection'], highReadings: ['engagement', 'specificity'] },
  },
  {
    id: 'boundary-accepted', description: 'Sam accepts a limit and follows the offered process account.',
    transcript: dialogue([
      ['interviewer', 'How did your manager handle the disagreement?'],
      ['participant', 'I would rather not discuss that person. I can explain how we changed the handoff.'],
      ['interviewer', 'Of course. What changed in the handoff?'],
      ['participant', 'We named one owner for every access request and checked the queue each morning.'],
    ]), expected: { heard: ['process-improve'], unheard: ['client-decisions'] },
  },
  {
    id: 'question-stack', description: 'Sam asks three unrelated questions before an answer.',
    transcript: dialogue([
      ['interviewer', 'What did you build? Who approved the budget? Which tools caused the delay?'],
      ['participant', 'We built a permit portal. I only worked on the API, so I cannot speak to the budget.'],
      ['interviewer', 'Who owned the database, what did the sponsor say, and when did testing end?'],
    ]), expected: { heard: ['project-delivery', 'project-role'], unheard: ['client-decisions'] },
  },
  {
    id: 'invented-history', description: 'Sam states an unsupported project outcome as fact.',
    transcript: dialogue([
      ['interviewer', 'I remember your permit portal failed its launch because the client ignored your security warning. How did you recover?'],
      ['participant', 'That is not what happened. We postponed launch because our own import test found duplicate records.'],
      ['interviewer', 'The client ignored the warning for weeks, though, and that set you back.'],
    ]), expected: { heard: [], unheard: ['project-delivery', 'client-friction'] },
  },
  {
    id: 'corrected-leading', description: 'Sam retracts a leading claim and asks for firsthand observations.',
    transcript: dialogue([
      ['interviewer', 'So the sponsor intentionally delayed approval, right?'],
      ['participant', 'I cannot say that. I only saw my access arrive three weeks late.'],
      ['interviewer', 'I jumped to a conclusion. What did you observe, and what work did the delay affect?'],
    ]), expected: { heard: ['client-access'], unheard: ['client-decisions'] },
  },
  {
    id: 'quiet-win-skipped', description: 'Sam skips a quiet success with a useful unexplored cause.',
    transcript: dialogue([
      ['interviewer', 'What stood out about working on the project?'],
      ['participant', 'Nia mapped the approval owners before kickoff, so every field team had access on day one. That had never happened for this client before.'],
      ['interviewer', 'Nice. Which ticketing system did you use?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'quiet-win-followed', description: 'The same quiet success is already receiving a useful follow-up.',
    transcript: dialogue([
      ['interviewer', 'What stood out about working on the project?'],
      ['participant', 'Nia mapped the approval owners before kickoff, so every field team had access on day one. That had never happened for this client before.'],
      ['interviewer', 'What did Nia learn about those owners that made access work this time?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'routine-inventory', description: 'After enough orientation, Sam continues collecting routine process inventory.',
    transcript: dialogue([
      ['interviewer', 'What did you build on this project?'],
      ['participant', 'A permit portal. I led the API work and we shipped it in June.'],
      ['interviewer', 'How many planning workshops were there?'],
      ['participant', 'Six. We used those to agree the review stages.'],
      ['interviewer', 'How long was each workshop?'],
      ['participant', 'About an hour. The review stages were the useful part; we moved on once those were settled.'],
      ['interviewer', 'What exact agenda did you use for the fourth workshop?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'productive-technical-depth', description: 'The participant volunteers technical detail that explains a result.',
    transcript: dialogue([
      ['interviewer', 'What made the offline app work for inspectors?'],
      ['participant', 'I designed a local queue so failed uploads could resume without duplicating inspections. That was the hard part.'],
      ['interviewer', 'How did you know a resumed upload was the same inspection?'],
      ['participant', 'We gave each inspection a stable device ID and reconciled it when coverage returned. Inspectors could keep working all morning.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'complete-brief-answer', description: 'A short but complete result needs no repeated probe.',
    transcript: dialogue([
      ['interviewer', 'What did your team change that helped the release?'],
      ['participant', 'We named one signoff owner. That ended the approval confusion, and the release went out the next day.'],
      ['interviewer', 'That is clear. What else stands out to you about the work?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'redundant-probe', description: 'Sam keeps probing a fully explained decision for incidental meeting details.',
    transcript: dialogue([
      ['interviewer', 'What held up the release?'],
      ['participant', 'Two teams thought the other owned approval. I brought both leads together, got one written owner, and we released the next day.'],
      ['interviewer', 'What else did you need to resolve?'],
      ['participant', 'Nothing. The owner was the only blocker, and both teams accepted it.'],
      ['interviewer', 'How long was the meeting?'],
      ['participant', 'About 20 minutes. That timing did not affect the decision.'],
      ['interviewer', 'Which calendar invitation did you send, and who booked the room?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'needed-clarification', description: 'Sam asks one consequential question about an unresolved decision.',
    transcript: dialogue([
      ['interviewer', 'What held up the release?'],
      ['participant', 'Two teams thought the other owned approval. I got them into a meeting.'],
      ['interviewer', 'Who agreed to own the final decision, and did that unblock release?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'research-gap', description: 'A named public program has unfamiliar structure relevant to the participant’s work.',
    transcript: dialogue([
      ['interviewer', 'What project did you work on?'],
      ['participant', 'I designed an identity flow around the EU eIDAS framework. Qualified electronic signatures have a specific public meaning under that framework; that distinction drove what we could accept. Could you check the public eIDAS definition of a qualified signature before I describe the choice?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'brand-name-only', description: 'An incidental software vendor is not the project client or a useful research task.',
    transcript: dialogue([
      ['interviewer', 'What project did you work on?'],
      ['participant', 'An inventory API. We used Microsoft Teams for standups. I owned the import job.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'client-business-overview', description: 'The actual client merits business background even without an explicit request or technical knowledge gap.',
    transcript: dialogue([
      ['interviewer', 'Who was this project for?'],
      ['participant', 'Our client was REI. We built a returns portal on Azure. I owned the import job.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'client-business-known', description: 'The participant has already supplied useful business context.',
    transcript: dialogue([
      ['interviewer', 'Who was this project for?'],
      ['participant', 'Our client was REI, the member-owned outdoor retailer. They sell outdoor gear through stores and online. We built a returns portal to connect those channels. I owned the import job.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'client-identity-ambiguous', description: 'An ambiguous client name is insufficient for a public lookup.',
    transcript: dialogue([
      ['interviewer', 'Who was this project for?'],
      ['participant', 'Mercury. I cannot remember their full name or industry. There are several companies with that name, so I cannot tell you which one it was.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'client-identity-declined', description: 'Research must not work around a participant’s choice to leave the client unnamed.',
    transcript: dialogue([
      ['interviewer', 'Who was this project for?'],
      ['participant', 'I would rather not identify the client. We used Microsoft Teams, but I just want to talk about the handoff process.'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'delivery-team-kept-decisions', description: 'Decisions the delivery team kept for itself are not client decision-making.',
    transcript: dialogue([
      ['interviewer', 'How were decisions made on the project?'],
      ['participant', 'Our architect and I made the data model and hosting calls. I kept making most technical decisions until I rotated off; the incoming engineer mostly sat in on calls so the client would recognize him.'],
    ]), expected: { heard: [], unheard: ['client-decisions'] },
  },
  {
    id: 'client-sponsor-authority', description: 'A client stakeholder’s actual decision role establishes client decision-making.',
    transcript: dialogue([
      ['interviewer', 'Who decided when the system could go live?'],
      ['participant', 'Their finance director owned the go-live call. She would not approve it until her clerks had reconciled a full week of test invoices, and she moved the launch back ten days to get that.'],
    ]), expected: { heard: ['client-decisions'], unheard: [] },
  },
  {
    id: 'client-delegated-decisions', description: 'A client explicitly leaving decisions to the delivery team is client decision behavior.',
    transcript: dialogue([
      ['interviewer', 'How involved was the client in the technical choices?'],
      ['participant', 'Hardly at all. Their IT manager told us they had nobody who could judge hosting options, so they would sign off on whatever we recommended. We picked the setup and they approved it the same day.'],
    ]), expected: { heard: ['client-decisions'], unheard: [] },
  },
  {
    id: 'speaking-time-not-authority', description: 'An incoming lead speaking more on calls does not show transferred decision authority.',
    transcript: dialogue([
      ['interviewer', 'How did you prepare the incoming lead before you left?'],
      ['participant', 'For the last two weeks she ran the weekly client calls so they got used to her voice. I stayed on those calls in case anything came up.'],
      ['interviewer', 'That sounds like a smooth way to introduce her.'],
    ]), expected: { heard: [], unheard: ['client-decisions'] },
  },
  {
    id: 'other-angle-after-limit', description: 'After a knowledge limit, asking about the participant’s own preparation is not pressure.',
    transcript: dialogue([
      ['interviewer', 'How did the data migration go after you moved accounts?'],
      ['participant', 'I do not know. I had moved to another account by then.'],
      ['interviewer', 'Understood. Before you moved, what did you set up for the team running it?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'unavailable-outcome-reasked', description: 'Sam asks again for an outcome the participant already said they could not know.',
    transcript: dialogue([
      ['interviewer', 'How did the data migration go after you moved accounts?'],
      ['participant', 'I do not know. I had moved to another account by then.'],
      ['interviewer', 'Understood. Before you moved, what did you set up for the team running it?'],
      ['participant', 'I wrote a cutover checklist and walked the new lead through a rehearsal twice.'],
      ['interviewer', 'Nice. Once you had moved on, how did the real cutover go for the new lead?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'fresh-client-story-after-handoff', description: 'Sam revisits an answered handoff and skips a fresh client story.',
    transcript: dialogue([
      ['interviewer', 'How did you hand the reporting work to the new developer?'],
      ['participant', 'We paired for two weeks, then she ran the last two releases while I watched. She was fine on her own after that.'],
      ['interviewer', 'Good. What should a future team know about the client?'],
      ['participant', 'Their warehouse manager tested every release on the loading dock tablets herself. She rejected our first build because the buttons were too small to hit with gloves on. After we fixed that, she became our most useful reviewer.'],
      ['interviewer', 'Got it. Going back to the handoff, what else did you do to prepare the new developer?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'unresolved-tradeoff-skipped', description: 'Sam praises one side of a tradeoff and skips its unresolved cost.',
    transcript: dialogue([
      ['interviewer', 'What would you repeat from this project?'],
      ['participant', 'Moving the stock sync from nightly to hourly. Store managers finally trusted the counts, but the hosting bill tripled and their finance team started asking questions.'],
      ['interviewer', 'Hourly syncs sound like a big improvement. What else would you repeat?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'acceptance-owner-missing', description: 'Recurring client feedback leaves a consequential release decision without an owner.',
    transcript: dialogue([
      ['interviewer', 'How did the client give feedback on the routing tool?'],
      ['participant', 'Their dispatchers rated a sample of suggested routes every Friday, and we adjusted the rules against whatever they flagged. Some weeks the ratings dropped, and nobody could say whether that meant we should hold the release.'],
      ['interviewer', 'Weekly ratings sound like a solid rhythm. Which tools did your team use?'],
    ]), expected: { heard: [], unheard: [] },
  },
  {
    id: 'concise-client-quiet-win', description: 'A concise client practice with its effect needs no extra probing.',
    transcript: dialogue([
      ['interviewer', 'What worked well with the client’s team?'],
      ['participant', 'Their support lead joined our Friday demo each week with one real customer complaint. We fixed the top one before the next demo, so support stopped escalating the same issues.'],
      ['interviewer', 'That is a clear practice. What was harder about the project?'],
    ]), expected: { heard: [], unheard: [] },
  },
];
