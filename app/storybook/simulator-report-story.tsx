import { useEffect, useState } from 'react';
import { useLoaderData } from 'react-router';
import type { DeepPartial } from 'ai';
import { skills, type Catalog, type ScenarioSummary, type SessionSnapshot } from '../../core/simulator/types';
import { REPORT_MAX_STARTS, type CoachingReport, type ReportState } from '../../core/simulator/report';
import { reportView, type ReportStage as Stage } from '../simulator/use-report';
import { SimulatorDebrief } from '../simulator/debrief';
import { happyHourFixture, recordedAttempt, simulatorFixtures } from './simulator-recordings';

const stages: Record<Stage, string> = { compiling: 'Compiling', writing: 'Streaming feedback', completed: 'Completed', failed: 'Failed · retry available', exhausted: 'Failed · retry used', unavailable: 'Session unavailable', ineligible: 'Too little conversation', 'status-error': 'Status connection lost' };

/** Illustrative coaching for the recorded examples; this preview never calls a provider. */
function exampleReport(snapshot: SessionSnapshot, scenario: ScenarioSummary, id: string): CoachingReport {
  const weak = id === 'one-sided-pitch' || id === 'scope-overpromise';
  const sparse = id === 'stakeholder-first';
  const trainee = snapshot.transcript.find(item => item.speaker === 'trainee')!.id;
  const client = snapshot.transcript.find(item => item.speaker === 'client')!.id;
  return {
    evaluation: {
      skills: Object.fromEntries(skills.map(({ id }, index) => [id, { score: sparse && index !== 4 ? null : weak ? [.8, 1.4, .6, 1.2, 2.1, .9, .7][index]! : [3.2, 3.1, 3.6, 3.3, 3.4, 3, 3.2][index]!, evidenceIds: sparse && index !== 4 ? [] : [trainee] }])) as CoachingReport['evaluation']['skills'],
      objectives: Object.fromEntries(scenario.objectives.map(objective => {
        const reading = snapshot.evaluation?.objectives.find(item => item.id === objective.id);
        return [objective.id, { achieved: weak ? false : reading?.achieved ?? false, evidenceIds: reading?.evidence ? [reading.evidence.entryId] : [] }];
      })),
    },
    overview: sparse ? 'You opened with a focused question about ownership. The conversation ended before there was enough evidence to assess how you would handle the client’s concerns.' : weak
      ? 'Your willingness to help came through, but the conversation moved toward a solution before the client’s concern was understood. Slow down at the moment they tell you what matters.'
      : 'You moved the conversation from a vague platform problem to a useful discussion about ownership and adoption. Your questions made room for the client’s real concern, and gave the next step a clear purpose.',
    strengths: weak ? [] : [{ text: 'Asking who owns the process brought the right stakeholder into the picture early. It kept the discussion grounded in how the work happens, rather than treating SharePoint as the whole problem.', evidenceIds: [trainee] }],
    improvements: sparse ? [] : [{ text: weak ? 'The client gave you a clear signal to explore the problem. Responding with a broad solution or an unsupported commitment made it harder to discover what would actually help. Acknowledge the concern, then ask one focused follow-up.' : 'Make the practical follow-through as clear as the discovery. Before closing, recap the person who needs to be involved, what you will bring, and the decision the next conversation should support.', evidenceIds: [trainee, client], alternative: weak ? 'Before we decide on a solution, what would need to change for this to work for your team?' : 'I’ll bring a short outline of the assessment. Can we invite your operations director to agree what it should answer?' }],
    nextPractice: sparse ? 'Continue past the opening question and respond to a specific concern before drawing conclusions about your performance.' : weak ? 'Use the client’s last answer to shape your next question before you recommend an approach.' : 'Close with one explicit action, its owner, and the purpose of the next conversation.',
  };
}

function ReportStory({ initialStage }: { initialStage: Stage }) {
  const catalog = (useLoaderData() as { simulatorCatalog: Catalog }).simulatorCatalog;
  const [id, setId] = useState('earned-discovery');
  const [stage, setStage] = useState<Stage>(initialStage);
  const [missing, setMissing] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(.4);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - start;
      setStage(elapsed < 2200 ? 'compiling' : elapsed < 9000 ? 'writing' : 'completed');
      setProgress(Math.min(1, Math.max(0, (elapsed - 2200) / 6800)));
      if (elapsed >= 9000) setPlaying(false);
    }, 80);
    return () => clearInterval(timer);
  }, [playing]);
  const choices = [...simulatorFixtures.filter(item => ['earned-discovery', 'one-sided-pitch', 'stakeholder-first', 'scope-overpromise'].includes(item.id)), happyHourFixture];
  const fixture = choices.find(item => item.id === id)!;
  const { snapshot, scenario, client } = recordedAttempt(catalog, fixture, fixture.transcript.length);
  snapshot.status = interrupted ? 'interrupted' : 'ended';
  snapshot.finalization = 'confirmed'; snapshot.usageSeconds = fixture.transcript.length * 12;
  if (interrupted) snapshot.message = 'The voice connection was interrupted.';
  if (missing) { snapshot.evaluation = null; snapshot.feedbackStatus = 'unavailable'; }
  const report = exampleReport(snapshot, scenario, id);
  const states: Record<Stage, ReportState> = {
    compiling: { status: 'running', starts: 1, report: null, failure: null },
    writing: { status: 'running', starts: 1, report: null, failure: null },
    'status-error': { status: 'running', starts: 1, report: null, failure: null },
    completed: { status: 'completed', starts: 1, report, failure: null },
    failed: { status: 'failed', starts: 1, report: null, failure: 'provider' },
    exhausted: { status: 'failed', starts: REPORT_MAX_STARTS, report: null, failure: 'provider' },
    ineligible: { status: 'ineligible', starts: 0, report: null, failure: null },
    unavailable: { status: 'unavailable', starts: 0, report: null, failure: null },
  };
  const draft: DeepPartial<CoachingReport> | undefined = stage === 'writing' ? {
    evaluation: report.evaluation,
    overview: report.overview.slice(0, Math.ceil(report.overview.length * Math.min(1, progress * 3))),
    ...(progress > .35 ? { strengths: report.strengths.map(point => ({ text: point.text.slice(0, Math.ceil(point.text.length * Math.min(1, (progress - .35) * 4))) })) } : {}),
    ...(progress > .6 ? { improvements: report.improvements.map(point => ({ text: point.text.slice(0, Math.ceil(point.text.length * Math.min(1, (progress - .6) * 4))) })) } : {}),
    ...(progress > .9 ? { nextPractice: report.nextPractice } : {}),
  } : undefined;
  return <>
    <div className="workshop-controls">
      <label>Report state<select value={stage} onChange={event => { setPlaying(false); setStage(event.target.value as Stage); }}>{Object.entries(stages).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Attempt<select value={id} onChange={event => setId(event.target.value)}>{choices.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      <label><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} />Missing Jev readings</label>
      <label><input type="checkbox" checked={interrupted} onChange={event => setInterrupted(event.target.checked)} />Interrupted conversation</label>
      <button className="quiet-button" disabled={playing} onClick={() => { setStage('compiling'); setProgress(0); setPlaying(true); }}>Replay generation</button>
      <small>Illustrative report · recorded conversation · no paid requests</small>
    </div>
    <SimulatorDebrief scenario={scenario} client={client} snapshot={snapshot} report={reportView({ state: states[stage], draft, loadError: stage === 'status-error' })}
      onRetryReport={() => { setStage('compiling'); setProgress(0); setPlaying(true); }} onCheckReport={() => setStage('completed')}
      onRetry={() => setNotice('Preview: start a new conversation with this scenario and client.')} onChoose={() => setNotice('Preview: choose a different scenario and client.')} />
    {notice && <p className="sim-notice" role="status">{notice}</p>}
  </>;
}
export const SimulatorDebriefStory = () => <ReportStory initialStage="completed" />;
export const ReportCompilingStory = () => <ReportStory initialStage="compiling" />;
export const ReportWritingStory = () => <ReportStory initialStage="writing" />;
export const ReportFailedStory = () => <ReportStory initialStage="failed" />;
