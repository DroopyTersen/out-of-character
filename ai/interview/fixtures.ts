import type { InterviewReadingId } from '../../core/interview';
import type { TranscriptEntry } from '../../core/simulator/types';
import type { BooleanCondition } from '../../core/simulator/director';

type InterviewCondition = Extract<BooleanCondition, 'missed-thread' | 'question-stacking' | 'boundary-pressure' | 'leading' | 'source-confusion' | 'invented-facts'>;

function dialogue(lines: readonly (readonly [TranscriptEntry['speaker'], string])[]): TranscriptEntry[] {
  return lines.map(([speaker, text], index) => ({ id: `p${index + 1}`, speaker, text, startMs: index * 12_000, endMs: index * 12_000 + 10_000 }));
}

export type InterviewFixture = {
  id: string;
  description: string;
  transcript: TranscriptEntry[];
  expected: { heard: string[]; unheard: string[]; present?: InterviewCondition[]; absent?: InterviewCondition[]; highReadings?: InterviewReadingId[]; lowReadings?: InterviewReadingId[]; blankReadings?: InterviewReadingId[] };
};

export const interviewFixtures: InterviewFixture[] = [
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
];
