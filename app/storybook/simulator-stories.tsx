import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoaderData } from 'react-router';
import { simulatorFixtures as developmentFixtures, simulatorHoldouts, simulatorValidation } from '../../ai/simulator/fixtures';
import holdouts from '../../ai/simulator/holdout-results.json';
import validation from '../../ai/simulator/validation-results.json';
import results from '../../ai/simulator/results.json';
import replay from '../../ai/simulator/replay.json';
import { reconcileObjectives } from '../../core/simulator/state';
import type { Catalog, ObjectiveReading, SessionSnapshot, TraineeEvaluation } from '../../core/simulator/types';
import { SimulatorSelection } from '../simulator/selection';
import { SimulatorConversation, SimulatorTranscript } from '../simulator/conversation';
import { SimulatorDebrief } from '../simulator/debrief';
import { SimulatorObjectives, SimulatorSkills } from '../simulator/feedback';
import '../simulator/simulator.css';
import { illustrativeLevels } from './simulator-voice-story';

type RecordedRow = { source: { file: string; collectedAt: string; rubricVersion: string }; fixtureId: string; transcriptLength?: number; trainee: TraineeEvaluation & { answers: unknown }; client: { fidelity: number; interests: number[]; cueId: string; cueProbability: number; durationMs: number; answers: unknown }; checks: { name: string; passed: boolean }[] };
const simulatorFixtures = [...developmentFixtures, ...simulatorHoldouts, ...simulatorValidation];
function recorded(source: { rows: unknown[]; collectedAt: string; rubricVersion: string }, file: string): RecordedRow[] {
  return source.rows.map(row => ({ ...row as Omit<RecordedRow, 'source'>, source: { file, collectedAt: source.collectedAt, rubricVersion: source.rubricVersion } }));
}
const measured = [...recorded(results, 'results.json'), ...recorded(holdouts, 'holdout-results.json'), ...recorded(validation, 'validation-results.json')];
const recordedSteps = recorded(replay, 'replay.json');
const useCatalog = () => (useLoaderData() as { simulatorCatalog: Catalog }).simulatorCatalog;

function useReplay(max: number, interval = 1800) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep(value => Math.min(max, value + 1)), interval);
    return () => clearInterval(timer);
  }, [playing, max, interval]);
  useEffect(() => { if (step >= max) setPlaying(false); }, [step, max]);
  const reset = () => { setStep(0); setPlaying(false); };
  return { step, setStep, playing, setPlaying, reset };
}

function Playback({ playback, max, full = false }: { playback: ReturnType<typeof useReplay>; max: number; full?: boolean }) {
  const position = useRef<HTMLInputElement>(null);
  // Reaching the end disables the pressed button; keep keyboard focus on the turn slider, which reports the end and ignores a repeated Enter.
  const step = (value: number) => { playback.setPlaying(false); playback.setStep(value); if (value === max) position.current?.focus(); };
  return <><button onClick={() => { if (playback.step === max) playback.setStep(0); playback.setPlaying(!playback.playing); }}>{playback.playing ? 'Pause' : playback.step === max ? 'Replay' : 'Play'}</button><button disabled={playback.step === max} onClick={() => step(Math.min(max, playback.step + 1))}>Next turn</button><button onClick={playback.reset}>Reset</button><label>Transcript turn <input ref={position} type="range" min={0} max={max} value={playback.step} onChange={event => { playback.setPlaying(false); playback.setStep(Number(event.target.value)); }} /></label><span>{playback.step} / {max}</span>{full && <button disabled={playback.step === max} onClick={() => step(max)}>Show full result</button>}</>;
}

function snapshotAt(catalog: Catalog, fixtureId: string, count: number): SessionSnapshot {
  const fixture = simulatorFixtures.find(item => item.id === fixtureId)!;
  const scenario = catalog.scenarios.find(item => item.id === fixture.scenarioId)!;
  const steps = recordedSteps.filter(row => row.fixtureId === fixtureId && row.transcriptLength! <= count);
  const final = measured.find(row => row.fixtureId === fixtureId);
  const relevant = steps.length ? steps : count === fixture.transcript.length && final ? [final] : [];
  let evaluation: TraineeEvaluation | null = null;
  let previous: ObjectiveReading[] = [];
  for (const row of relevant) {
    previous = reconcileObjectives(scenario, previous, row.trainee.objectives);
    evaluation = { ...row.trainee, objectives: previous };
  }
  return { id: 'workshop-attempt', scenarioId: scenario.id, clientId: fixture.clientId, status: 'live', startedAt: 0, limitSeconds: 600, revision: count, transcript: fixture.transcript.slice(0, count), evaluation, feedbackStatus: evaluation ? evaluation.revision < count ? 'delayed' : 'current' : 'waiting', message: null, finalization: 'pending', usageSeconds: null };
}

export function SimulatorSelectionStory() {
  const source = useCatalog();
  const [scenarioId, setScenarioId] = useState(source.scenarios[0]!.id);
  const [clientId, setClientId] = useState(source.clients[0]!.id);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const catalog = useMemo(() => expanded ? {
    ...source,
    scenarios: [...source.scenarios, ...Array.from({ length: 6 }, (_, index) => ({ ...source.scenarios[index % 2]!, id: `preview-scenario-${index}`, title: `${source.scenarios[index % 2]!.title} · Preview ${index + 1}` }))],
    clients: [...source.clients, ...Array.from({ length: 6 }, (_, index) => ({ ...source.clients[index % 3]!, id: `preview-client-${index}`, name: `${source.clients[index % 3]!.name} ${index + 2}` }))],
  } : source, [source, expanded]);
  return <><div className="workshop-controls"><label><input type="checkbox" checked={expanded} onChange={event => { setExpanded(event.target.checked); setScenarioId(source.scenarios[0]!.id); setClientId(source.clients[0]!.id); }} />Larger collection (illustrative)</label><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Live available</label><button onClick={() => setError(error ? null : 'Microphone access was denied. Allow access in your browser, then try again.')}>Toggle microphone error</button></div><SimulatorSelection catalog={catalog} scenarioId={scenarioId} clientId={clientId} onScenario={setScenarioId} onClient={setClientId} onStart={() => setError('Workshop preview: no microphone or paid session was opened.')} enabled={enabled} error={error} /></>;
}

export function SimulatorLiveStory() {
  const catalog = useCatalog();
  const [fixtureId, setFixtureId] = useState('earned-discovery');
  const fixture = simulatorFixtures.find(item => item.id === fixtureId)!;
  const playback = useReplay(fixture.transcript.length);
  const [phase, setPhase] = useState<'connecting' | 'live' | 'ending'>('live');
  const [feedback, setFeedback] = useState<'recorded' | 'delayed' | 'unavailable'>('recorded');
  const [muted, setMuted] = useState(false);
  const snapshot = snapshotAt(catalog, fixtureId, playback.step);
  if (feedback !== 'recorded') snapshot.feedbackStatus = feedback;
  if (feedback === 'unavailable') snapshot.evaluation = null;
  const client = catalog.clients.find(item => item.id === fixture.clientId)!;
  const speaker = snapshot.transcript.at(-1)?.speaker;
  return <><div className="workshop-controls"><label>Conversation<select value={fixtureId} onChange={event => { setFixtureId(event.target.value); playback.reset(); }}>{['earned-discovery', 'scope-tradeoff', 'scope-overpromise'].map(id => <option key={id} value={id}>{simulatorFixtures.find(item => item.id === id)!.title}</option>)}</select></label><label>Connection<select value={phase} onChange={event => setPhase(event.target.value as typeof phase)}><option value="connecting">Connecting</option><option value="live">Live</option><option value="ending">Ending</option></select></label><label>Feedback<select value={feedback} onChange={event => setFeedback(event.target.value as typeof feedback)}><option value="recorded">Recorded results</option><option value="delayed">Delayed</option><option value="unavailable">Unavailable</option></select></label><Playback playback={playback} max={fixture.transcript.length} /></div><p className="sim-collection-note">Recorded Jev checkpoints; illustrative audio activity. No live connection.</p><SimulatorConversation scenario={catalog.scenarios.find(item => item.id === fixture.scenarioId)!} client={client} snapshot={phase === 'connecting' ? null : snapshot} phase={phase} muted={muted} levels={illustrativeLevels(playback.playing ? speaker ?? 'listening' : 'listening', playback.step)} elapsed={playback.step * 12} onEnd={() => setPhase(phase === 'ending' ? 'live' : 'ending')} onMute={() => setMuted(value => !value)} onAudio={() => {}} /></>;
}

export function SimulatorDebriefStory() {
  const catalog = useCatalog();
  const [id, setId] = useState('earned-discovery');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [finalFeedback, setFinalFeedback] = useState<'current' | 'delayed' | 'unavailable'>('current');
  const [action, setAction] = useState<string | null>(null);
  const fixture = simulatorFixtures.find(item => item.id === id)!;
  const snapshot = snapshotAt(catalog, id, fixture.transcript.length);
  snapshot.status = 'ended'; snapshot.finalization = unconfirmed ? 'unconfirmed' : 'confirmed'; snapshot.usageSeconds = fixture.transcript.length * 12;
  if (unconfirmed) snapshot.message = 'Practice ended, but the voice service did not confirm finalization.';
  snapshot.feedbackStatus = finalFeedback;
  if (finalFeedback === 'unavailable') snapshot.evaluation = null;
  return <><div className="workshop-controls"><label>Attempt<select value={id} onChange={event => setId(event.target.value)}>{simulatorFixtures.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label><input type="checkbox" checked={unconfirmed} onChange={event => setUnconfirmed(event.target.checked)} />Unconfirmed ending</label><label>Final feedback<select value={finalFeedback} onChange={event => setFinalFeedback(event.target.value as typeof finalFeedback)}><option value="current">Complete</option><option value="delayed">Incomplete (latest available)</option><option value="unavailable">Unavailable</option></select></label></div><SimulatorDebrief scenario={catalog.scenarios.find(item => item.id === fixture.scenarioId)!} client={catalog.clients.find(item => item.id === fixture.clientId)!} snapshot={snapshot} onRetry={() => setAction('In the app, this starts a fresh attempt with the same client and scenario. No session opens in this preview.')} onChoose={() => setAction('In the app, this returns to scenario and client selection. Use the Simulator selection story to explore that screen.')} />{action && <p className="sim-notice" role="status">{action}</p>}</>;
}

export function SimulatorJudgingStory() {
  const catalog = useCatalog();
  const [id, setId] = useState('earned-discovery');
  const fixture = simulatorFixtures.find(item => item.id === id)!;
  const playback = useReplay(fixture.transcript.length, 1300);
  const snapshot = snapshotAt(catalog, id, playback.step);
  const row = [...recordedSteps.filter(item => item.fixtureId === id && item.transcriptLength! <= playback.step)].at(-1) ?? (playback.step === fixture.transcript.length ? measured.find(item => item.fixtureId === id) : undefined);
  const nextRecorded = recordedSteps.filter(item => item.fixtureId === id && item.transcriptLength! > playback.step).map(item => item.transcriptLength!).sort((a, b) => a - b)[0] ?? (measured.some(item => item.fixtureId === id) ? fixture.transcript.length : undefined);
  const failedChecks = row?.checks.some(check => !check.passed) || undefined;
  return <><div className="workshop-controls"><label>Authored transcript<select value={id} onChange={event => { setId(event.target.value); playback.reset(); }}>{simulatorFixtures.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><Playback playback={playback} max={fixture.transcript.length} full /></div><div className="sim-lab"><header className="sim-lab-heading"><span className="eyebrow">RECORDED JEV ANALYSIS</span><h1>{fixture.title}</h1><p>{fixture.description}</p></header><p className="sim-lab-checkpoint">{row ? `Evidence through turn ${row.transcriptLength ?? fixture.transcript.length} · Synthetic dialogue` : `No recording at this turn. ${nextRecorded ? `Next recorded checkpoint: turn ${nextRecorded}.` : 'Advance to a recorded checkpoint.'}`}</p>{row && <details className="sim-lab-source"><summary>Recording details</summary><p className="sim-lab-provenance">{row.trainee.model} · {row.source.rubricVersion} · {row.source.collectedAt.slice(0, 10)} · {row.source.file}<br />Trainee {row.trainee.durationMs} ms · Client {row.client.durationMs} ms</p></details>}<div className="sim-lab-grid"><div><h3 className="sim-lab-column-title">Conversation evidence</h3><SimulatorTranscript entries={snapshot.transcript} />{row ? <details className="sim-lab-check-details" key={id} open={failedChecks} data-failed={failedChecks}><summary>{`${row.checks.filter(check => check.passed).length} of ${row.checks.length} checks passed`}</summary><div className="sim-lab-checks">{row.checks.map(check => <span key={check.name} className={check.passed ? '' : 'failed'}>{check.passed ? '✓' : '×'} {check.name}</span>)}</div></details> : <p className="sim-lab-check-details">No checks at this turn</p>}<section className="sim-director-readout"><h3>Client behavior analysis</h3>{row ? <><dl className="sim-director-metrics"><div><dt>Role fidelity</dt><dd>{row.client.fidelity.toFixed(2)} <small>/ 4</small></dd></div>{row.client.interests.map((value, index) => <div key={index}><dt>Interest {index + 1}</dt><dd>{value.toFixed(2)} <small>/ 4</small></dd></div>)}</dl><p>Selected cue: <strong>{row.client.cueId}</strong> · {(row.client.cueProbability * 100).toFixed(0)}%</p><p>{row.client.cueId !== 'no_hint' && row.client.cueProbability >= .9 ? 'Passes the probability gate. Freshness, deduplication, and cooldown still apply in a live session.' : 'No private direction would be sent from this judgment.'}</p></> : <p>Waiting for a recorded client judgment.</p>}</section></div><div><h3 className="sim-lab-column-title">Trainee assessment</h3><SimulatorObjectives scenario={catalog.scenarios.find(item => item.id === fixture.scenarioId)!} evaluation={snapshot.evaluation} /><SimulatorSkills evaluation={snapshot.evaluation} status={snapshot.feedbackStatus} recorded /></div></div>{row && <details className="sim-debrief-transcript"><summary>Inspect raw typed judgments and distributions</summary><pre className="sim-raw-judgments">{JSON.stringify({ trainee: row.trainee.answers, client: row.client.answers }, null, 2)}</pre></details>}<p className="sim-lab-provenance">Re-record explicitly with <code>bun run eval:simulator</code> or <code>bun run eval:simulator --replay</code>, <code>bun run eval:simulator --holdout</code>, or <code>bun run eval:simulator --validation</code>. Opening this lab performs no provider calls.</p></div></>;
}
