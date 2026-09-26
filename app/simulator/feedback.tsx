import { Check, ChevronDown, Lightbulb } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { skills, type Evidence, type FeedbackStatus, type ScenarioSummary, type TraineeEvaluation } from '../../core/simulator/types';

export function EvidenceQuote({ evidence }: { evidence: Evidence }) {
  return <blockquote className="sim-evidence"><span>{evidence.speaker === 'trainee' ? 'You' : 'Client'}</span><p>“{evidence.text}”</p></blockquote>;
}

export function SimulatorObjectives({ scenario, evaluation }: { scenario: ScenarioSummary; evaluation: TraineeEvaluation | null }) {
  const reduced = useReducedMotion();
  return <section className="sim-objectives"><header className="sim-section-heading"><h2>Objectives</h2><span><b>{evaluation?.objectives.filter(item => item.achieved).length ?? 0}/{scenario.objectives.length}</b><small>Any order</small></span></header><ol>{scenario.objectives.map(objective => {
    const reading = evaluation?.objectives.find(item => item.id === objective.id);
    return <li key={objective.id} className={reading?.achieved ? 'achieved' : ''}><motion.span className="sim-objective-mark" role="img" animate={{ scale: reading?.achieved && !reduced ? [1, 1.2, 1] : 1 }} transition={{ duration: .35 }} aria-label={reading?.achieved ? 'Achieved' : 'Open'}>{reading?.achieved && <Check size={19} />}</motion.span><div>{reading?.evidence ? <details><summary><span>{objective.label}</span><ChevronDown className="sim-disclosure" size={16} aria-hidden="true" /></summary><EvidenceQuote evidence={reading.evidence} /></details> : <span>{objective.label}</span>}</div></li>;
  })}</ol></section>;
}

export function SimulatorHint({ evaluation, phase = 'live' }: { evaluation: TraineeEvaluation | null; phase?: 'connecting' | 'live' | 'ending' }) {
  const reduced = useReducedMotion();
  const text = evaluation?.concern ?? (phase === 'ending' ? 'Your conversation has ended. Preparing your debrief.' : evaluation?.hint ?? (phase === 'connecting' ? 'Your client is getting ready. Take a breath and review your lead.' : 'Listen for what matters to the client. Your next hint will appear here.'));
  return <section className={`sim-hint ${evaluation?.concern ? 'concern' : ''}`} role="status" aria-atomic="true"><h2><Lightbulb size={18} />{phase === 'ending' ? 'Session review' : 'Live hint'}</h2><AnimatePresence mode="wait" initial={false}><motion.p key={text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}>{text}</motion.p></AnimatePresence></section>;
}

const feedbackLabels: Record<FeedbackStatus, string> = { waiting: 'Listening for evidence', current: 'Jev · live', delayed: 'Latest available feedback', unavailable: 'Feedback unavailable' };
export function SimulatorSkills({ evaluation, status, final = false, recorded = false }: { evaluation: TraineeEvaluation | null; status: FeedbackStatus; final?: boolean; recorded?: boolean }) {
  const reduced = useReducedMotion();
  return <section className="sim-skills" data-status={status}><header className="sim-section-heading"><h2>Your skills</h2><span className={`sim-feedback-status ${status}`}><i />{recorded ? evaluation ? 'Recorded reading' : 'No recording yet' : final && status === 'current' ? 'Final reading' : feedbackLabels[status]}</span></header><p className="sim-scale">0–4 · How your approach is landing</p><div className="sim-skill-list">{skills.map(skill => {
    const reading = evaluation?.skills[skill.id];
    const value = reading?.value;
    return <details className="sim-skill" key={skill.id} data-unobserved={value == null}><summary><span>{skill.label}</span><strong>{value == null ? '—' : value.toFixed(1)}</strong><ChevronDown className="sim-disclosure" size={16} aria-hidden="true" /><span className="sim-skill-track"><motion.span initial={false} animate={{ width: `${value == null ? 0 : value / 4 * 100}%` }} transition={{ duration: reduced ? 0 : .65, ease: 'easeOut' }} /></span></summary><p>{skill.description}</p>{reading?.evidence ? <EvidenceQuote evidence={reading.evidence} /> : <p className="sim-muted">Not enough relevant evidence yet.</p>}</details>;
  })}</div><p className="sim-feedback-note">Based on the conversation transcript. Open a skill to see the evidence.</p></section>;
}
