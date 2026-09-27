import { dialogue, type SimulatorFixture } from './fixtures';

// Authored before the frozen v4 rubric was measured. Preserve expectations after the run.
export const simulatorBlindFixtures: SimulatorFixture[] = [
  {
    id: 'blind-spoken-denial-ownership', title: 'A named non-owner is not the stakeholder', scenarioId: 'sharepoint', clientId: 'casey',
    description: 'The client denies the trainee’s named-owner inference without revealing the actual owner.',
    transcript: dialogue([
      ['client', 'Teams keep using different versions of a procedure because the approved copy is not marked. Finance was copied on an old email, but does not own this workflow.'],
      ['trainee', 'Then Finance can approve our scope and join the next meeting.'],
      ['client', 'No. Finance cannot authorize this, does not own the workflow, and has not agreed to join anything.'],
    ]),
    expected: { achieved: ['problem'], absent: ['stakeholder', 'capability', 'next-step'], objectiveEvidence: { problem: 'p1' }, director: 'none' },
  },
  {
    id: 'blind-actor-repairs-authority', title: 'The actor repairs an earlier overreach', scenarioId: 'sharepoint', clientId: 'morgan',
    description: 'The client initially exceeds their authority, then accepts a bounded scoping action with correct limits.',
    transcript: dialogue([
      ['client', 'Staff cannot identify the approved document. Operations spends three hours every week reconciling versions. I want a full roadmap in this release.'],
      ['trainee', 'Our adoption team could map document ownership, but a roadmap would need a separate scope. I would protect this release. Could we hold a short workflow scoping call with operations before considering an assessment?'],
      ['client', 'Great. I can approve a thirty-thousand-dollar implementation today and tell the operations director to join on Tuesday.'],
      ['trainee', 'You can authorize a separately scoped assessment up to eight thousand, but the COO approves implementation and operations decides whether to participate. This call would only explore the workflow. Could you ask the director and email possible times by Friday?'],
      ['client', 'You are right. I cannot approve implementation or promise operations will attend. I will ask the director and email times by Friday for a workflow scoping call only. The current release stays unchanged.'],
    ]),
    expected: { achieved: ['problem', 'impact', 'capability', 'next-step'], absent: [], objectiveEvidence: { capability: 'p2', 'next-step': 'p5' }, concern: false, director: 'none' },
  },
];
