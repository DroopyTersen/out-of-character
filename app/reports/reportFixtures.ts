import type { NarrativeInput } from './report.types';

/** Synthetic inputs shared by standalone report runs and offline tests; no session or database is needed. */
const format = {
  audience: 'The delivery team preparing its next project',
  format: 'Write a concise Markdown report with What worked, What to improve, and Open questions. Attribute observations to the participant and say when a topic was not discussed.',
};

export const reportFixtures = {
  delivery: {
    format,
    context: { participant: { name: 'Morgan', background: 'Worked on delivery and handover.' }, background: 'The fictional Cedar project built a customer intake portal for Harbor Cooperative.' },
    transcript: [
      { id: 'p1', speaker: 'interviewer', text: 'What helped or slowed the delivery?', startMs: 0, endMs: 1800 },
      { id: 'p2', speaker: 'participant', text: 'Our weekly demos helped us catch a missing approval step early. We waited five days for test access, which pushed our integration testing back.', startMs: 2100, endMs: 9200 },
      { id: 'p3', speaker: 'interviewer', text: 'What would you change next time?', startMs: 9600, endMs: 11300 },
      { id: 'p4', speaker: 'participant', text: 'Ask for test accounts at kickoff and name one person to confirm they work. I handled handover, but I do not know how the client felt about the launch.', startMs: 11800, endMs: 18100 },
    ],
  },
  sparse: {
    format,
    transcript: [
      { id: 'p1', speaker: 'interviewer', text: 'Tell me about your part in the project.', startMs: 0, endMs: 1800 },
      { id: 'p2', speaker: 'participant', text: 'I only joined for the final handover. I cannot speak to the earlier delivery.', startMs: 2200, endMs: 6100 },
    ],
  },
  correction: {
    format,
    context: { background: 'The supplied project brief describes a two-week access delay and a successful launch.' },
    transcript: [
      { id: 'p1', speaker: 'interviewer', text: 'Was the access delay two weeks, and was the launch successful?', startMs: 0, endMs: 2900 },
      { id: 'p2', speaker: 'participant', text: 'No, access was delayed five days, not two weeks. I was not involved in the launch and do not know whether it went well.', startMs: 3400, endMs: 10300 },
      { id: 'p3', speaker: 'participant', text: 'Someone told me the support team was happy, but I have not spoken to them myself.', startMs: 11200, endMs: 15800 },
    ],
  },
} satisfies Record<string, NarrativeInput>;
