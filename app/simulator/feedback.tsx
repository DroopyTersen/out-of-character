import { Check, ChevronDown, Lightbulb, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { skills, type Evidence, type FeedbackStatus, type LiveHint, type ScenarioSummary, type FeedbackAssessment } from '../../core/simulator/types';

export function EvidenceQuote({ evidence }: { evidence: Evidence }) {
  return <blockquote className="sim-evidence"><span>{evidence.speaker === 'trainee' ? 'You' : 'Client'}</span><p>“{evidence.text}”</p></blockquote>;
}

export function SimulatorObjectives({ scenario, evaluation, unavailable = false, countLabel = 'Any order' }: { scenario: ScenarioSummary; evaluation: FeedbackAssessment | null; unavailable?: boolean; countLabel?: string }) {
  const reduced = useReducedMotion();
  return <section className="sim-objectives"><header className="sim-section-heading"><h2>Objectives</h2><span><b>{unavailable ? '—' : evaluation?.objectives.filter(item => item.achieved).length ?? 0}/{scenario.objectives.length}</b><small>{unavailable ? 'Unavailable' : countLabel}</small></span></header><ol>{scenario.objectives.map(objective => {
    const reading = evaluation?.objectives.find(item => item.id === objective.id);
    return <li key={objective.id} className={reading?.achieved ? 'achieved' : ''}><motion.span className="sim-objective-mark" role="img" animate={{ scale: reading?.achieved && !reduced ? [1, 1.2, 1] : 1 }} transition={{ duration: .35 }} aria-label={unavailable ? 'Unavailable' : reading?.achieved ? 'Achieved' : 'Open'}>{reading?.achieved && <Check size={19} />}</motion.span><div>{reading?.evidence ? <details><summary><span>{objective.label}</span><ChevronDown className="sim-disclosure" size={16} aria-hidden="true" /></summary><EvidenceQuote evidence={reading.evidence} /></details> : <span>{objective.label}</span>}</div></li>;
  })}</ol></section>;
}

export function SimulatorHintToast({ text, concern, onDismiss }: { text: string | null | undefined; concern: boolean; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  return <><div className="sim-announcement" role="status" aria-atomic="true">{text}</div>{text && <motion.aside className={`sim-hint-toast ${concern ? 'concern' : ''}`} key={text} initial={{ opacity: 0, y: reduced ? 0 : -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
    <Lightbulb size={22} aria-hidden="true" /><div><h2>Live hint</h2><p>{text}</p></div><button onClick={onDismiss} aria-label="Dismiss hint"><X size={20} /></button>
  </motion.aside>}</>;
}

export function SimulatorHint({ phase, liveHint, onDismiss }: { phase: 'connecting' | 'live' | 'ending'; liveHint: LiveHint | null; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  const concern = liveHint?.kind === 'concern';
  const text = phase === 'ending' ? 'Your conversation has ended. Preparing your debrief.' : liveHint?.text ?? (phase === 'connecting' ? 'Your client is getting ready. Take a breath and review your lead.' : 'Listen for what matters to the client. Your next hint will appear here.');
  return <section className={`sim-hint ${concern ? 'concern' : ''}`} role="status" aria-atomic="true"><h2><Lightbulb size={18} />{phase === 'ending' ? 'Session review' : 'Live hint'}{liveHint && onDismiss && <button className="quiet-button" onClick={onDismiss} aria-label="Dismiss hint"><X size={18} /></button>}</h2><AnimatePresence mode="wait" initial={false}><motion.p key={text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}>{text}</motion.p></AnimatePresence></section>;
}

const feedbackLabels: Record<FeedbackStatus, string> = { waiting: 'Listening for evidence', current: 'Jev · live', delayed: 'Latest available feedback', unavailable: 'Feedback unavailable' };
export function SimulatorSkills({ evaluation, status, final = false, recorded = false, compact = false, readingLabel }: { evaluation: FeedbackAssessment | null; status: FeedbackStatus; final?: boolean; recorded?: boolean; compact?: boolean; readingLabel?: string }) {
  const reduced = useReducedMotion();
  return <section className={`sim-skills ${compact ? 'sim-mobile-compact' : ''}`} data-status={status}><header className="sim-section-heading"><h2>Your skills</h2><span className={`sim-feedback-status ${status}`}><i />{readingLabel ?? (recorded ? evaluation ? 'Recorded reading' : 'No recording yet' : feedbackLabels[status])}</span>{compact && <span className="sim-scale sim-mobile-only">0–4</span>}</header><p className={`sim-scale ${compact ? 'sim-desktop-only' : ''}`}>0–4 · How your approach is landing</p><div className="sim-skill-list">{skills.map(skill => {
    const reading = evaluation?.skills[skill.id];
    // Keep the color band and bar aligned with the visible one-decimal score.
    const value = reading?.value == null ? null : Number(reading.value.toFixed(1));
    const rating = value == null ? undefined : value <= 1 ? 'poor' : value < 2 ? 'low' : value < 3 ? 'mixed' : 'strong';
    return <details className="sim-skill" key={skill.id} data-rating={rating} data-unobserved={value == null}><summary><span>{skill.label}</span><strong>{value == null ? '—' : value.toFixed(1)}</strong><ChevronDown className="sim-disclosure" size={16} aria-hidden="true" /><span className="sim-skill-track"><motion.span initial={false} animate={{ width: `${value == null ? 0 : value / 4 * 100}%` }} transition={{ duration: reduced ? 0 : .65, ease: 'easeOut' }} /></span></summary><p>{skill.description}</p>{reading?.evidence ? <EvidenceQuote evidence={reading.evidence} /> : <p className="sim-muted">{!final ? 'Not enough relevant evidence yet.' : evaluation ? 'No relevant evidence was found for this skill.' : 'No assessment was available for this attempt.'}</p>}</details>;
  })}{compact && <p className="sim-feedback-note sim-mobile-only">{evaluation ? 'Tap a skill for evidence.' : 'Tap a skill for details.'}</p>}</div><p className={`sim-feedback-note ${compact ? 'sim-desktop-only' : ''}`}>Based on the conversation transcript. Open a skill to see the evidence.</p></section>;
}
