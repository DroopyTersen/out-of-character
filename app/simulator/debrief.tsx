import { RotateCcw, ArrowLeft, LoaderCircle, ArrowRight, ChevronDown } from 'lucide-react';
import { reportEvaluation } from '../../core/simulator/report';
import { findEvidence } from '../../core/simulator/state';
import type { Client, ScenarioSummary, SessionSnapshot } from '../../core/simulator/types';
import { EvidenceQuote, SimulatorObjectives, SimulatorSkills } from './feedback';
import { formatTime, SimulatorTranscript } from './conversation';
import type { ReportStage, ReportView } from './use-report';

const pendingCopy = { title: 'Compiling your report', assessment: 'These readings may change after the final review.' };
const unavailableCopy = { title: 'Final report unavailable', assessment: 'Readings from your conversation; a final review is not available yet.' };
const reportCopy: Record<ReportStage, { title: string; assessment: string; detail?: string }> = {
  compiling: pendingCopy,
  writing: { ...pendingCopy, title: 'Writing your feedback' },
  completed: { title: 'Your next step forward', assessment: 'Reviewed against the full conversation.' },
  failed: unavailableCopy,
  exhausted: unavailableCopy,
  ineligible: { ...unavailableCopy, detail: 'There isn’t enough conversation to review.' },
  unavailable: { ...unavailableCopy, detail: 'This session is no longer available for a final review.' },
  'status-error': { title: 'Couldn’t load your report', assessment: 'Your latest readings are still available.', detail: 'Your report may still be finishing. Check its status without starting another review.' },
};

export function SimulatorDebrief({ scenario, client, snapshot: liveSnapshot, report, onRetryReport, onCheckReport, onRetry, onChoose, error }: {
  scenario: ScenarioSummary; client: Client; snapshot: SessionSnapshot | null; report: ReportView;
  onRetryReport?: () => void; onCheckReport?: () => void; onRetry: () => void; onChoose: () => void; error?: string | null;
}) {
  const snapshot = report.snapshot ?? liveSnapshot;
  const openEnded = scenario.objectives.length === 0;
  const finalReport = report.state.status === 'completed' ? report.state.report : null;
  const complete = !!finalReport;
  const writing = report.stage === 'compiling' || report.stage === 'writing';
  const content = finalReport ?? (writing ? report.draft : null);
  const evaluation = finalReport && snapshot ? reportEvaluation(finalReport, snapshot) : snapshot?.evaluation ?? null;
  const copy = reportCopy[report.stage];
  const unavailable = copy.detail ?? (evaluation ? 'Your conversation and provisional assessment are still available below.' : 'Your conversation is still available below.');

  function evidence(ids: (string | undefined)[] | undefined) {
    if (!complete || !snapshot || !ids?.length) return null;
    return <details className="sim-report-evidence"><summary>See the moment</summary>{ids.flatMap(id => {
      const quote = id && findEvidence(snapshot.transcript, id);
      return quote ? [<EvidenceQuote key={quote.entryId} evidence={quote} />] : [];
    })}</details>;
  }

  return <section className="sim-debrief">
    <header className="sim-heading">
      <span className="eyebrow">{openEnded ? 'THE CONVERSATION' : 'THE DEBRIEF'} · {client.name.toUpperCase()}</span>
      <h1 tabIndex={-1}>{openEnded ? 'Your conversation' : 'Your session debrief'}</h1>
      <p>{scenario.title} · {formatTime(snapshot?.usageSeconds ?? (snapshot?.transcript.at(-1)?.endMs ?? 0) / 1000)}</p>
    </header>
    {(error || snapshot?.message) && <p className="sim-notice" role="status">{error || snapshot?.message}</p>}
    {openEnded ? <div className="sim-outcome"><img src={client.image} alt="" /><div className="sim-outcome-copy"><span className="eyebrow">CONVERSATION ENDED</span><strong>An open conversation with {client.name}.</strong></div></div> : <div className="sim-debrief-content">
      <section className="sim-report" aria-label="Session feedback" aria-busy={writing} data-failed={report.state.status === 'failed'}>
        <header className="sim-report-heading"><img src={client.image} alt="" /><div><span className="eyebrow">YOUR FEEDBACK</span><h2>{copy.title}</h2></div>{writing && <LoaderCircle className="sim-report-spinner" size={24} aria-hidden="true" />}</header>
        <span className="sim-announcement" role="status">{complete ? 'Your final assessment is ready.' : copy.title}</span>
        {report.stage === 'status-error' ? <><p>{copy.detail}</p><button className="quiet-button" onClick={onCheckReport}>Check report</button></>
          : !writing && !complete ? <><p className="sim-muted">{unavailable}</p>{report.canRetry && onRetryReport && <button className="quiet-button" onClick={onRetryReport}><RotateCcw size={17} /> Retry report</button>}</>
          : <>
            {!content?.overview && <p className="sim-muted sim-report-pending">{evaluation ? 'Your scores are ready below. The final review is on its way.' : 'Reviewing your conversation. No provisional readings were captured.'}</p>}
            {content?.overview && <p className="sim-report-overview">{content.overview}</p>}
            {!!content?.strengths?.length && <section className="sim-report-points"><h3>What worked</h3>{content.strengths.map((point, index) => point?.text && <article key={index}><p>{point.text}</p>{evidence(point.evidenceIds)}</article>)}</section>}
            {!!content?.improvements?.length && <section className="sim-report-points"><h3>What to try differently</h3>{content.improvements.map((point, index) => point?.text && <article key={index}><p>{point.text}</p>{point.alternative && <p className="sim-report-alternative"><span>Try saying</span> {point.alternative}</p>}{evidence(point.evidenceIds)}</article>)}</section>}
            {content?.nextPractice && <div className="sim-report-next"><ArrowRight size={20} aria-hidden="true" /><div><h3>Next time, focus on</h3><p>{content.nextPractice}</p></div></div>}
          </>}
      </section>
      <section className="sim-assessment" data-final={complete} aria-label={complete ? 'Final assessment' : 'Provisional assessment'}>
        <header className="sim-assessment-heading"><h2>{complete ? 'Final assessment' : 'Provisional assessment'}</h2><p>{!evaluation ? 'No provisional readings were captured.' : copy.assessment}</p></header>
        <div className="sim-debrief-grid">
          <SimulatorObjectives scenario={scenario} evaluation={evaluation} unavailable={!evaluation} countLabel={complete ? 'Confirmed' : 'Provisional'} />
          <SimulatorSkills evaluation={evaluation} status={evaluation ? 'current' : 'unavailable'} final compact readingLabel={!evaluation ? 'No reading available' : complete ? 'Final reading' : 'Provisional reading'} />
        </div>
      </section>
    </div>}
    <details className="sim-debrief-transcript"><summary><span>Review the full conversation</span><ChevronDown size={17} aria-hidden="true" /></summary><SimulatorTranscript entries={snapshot?.transcript ?? []} /></details>
    <div className="sim-debrief-actions">
      <button className="arcade-button primary" onClick={onRetry}><RotateCcw size={20} />Try this again</button>
      <button className="quiet-button" onClick={onChoose}><ArrowLeft size={17} />Choose another simulation</button>
    </div>
  </section>;
}
