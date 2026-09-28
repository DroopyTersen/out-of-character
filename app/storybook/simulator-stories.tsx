import { useEffect, useMemo, useRef, useState } from 'react';
import { useLoaderData } from 'react-router';
import { emptySkills, type Catalog } from '../../core/simulator/types';
import { happyHourFixture, recordedAttempt, simulatorFixtures } from './simulator-recordings';
import { SimulatorSelection } from '../simulator/selection';
import { SimulatorConversation, SimulatorTranscript } from '../simulator/conversation';
import { SimulatorObjectives, SimulatorSkills } from '../simulator/feedback';
import '../simulator/simulator.css';
import { illustrativeLevels } from './simulator-voice-story';
import { SimulatorClientStats } from './simulator-client-stats';

const useCatalog = () => (useLoaderData() as { simulatorCatalog: Catalog }).simulatorCatalog;

function useReplay(max: number, interval = 1800) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((value) => Math.min(max, value + 1)), interval);
    return () => clearInterval(timer);
  }, [playing, max, interval]);
  useEffect(() => {
    if (step >= max) setPlaying(false);
  }, [step, max]);
  const reset = () => {
    setStep(0);
    setPlaying(false);
  };
  return { step, setStep, playing, setPlaying, reset };
}

function Playback({
  playback,
  max,
  full = false,
}: {
  playback: ReturnType<typeof useReplay>;
  max: number;
  full?: boolean;
}) {
  const position = useRef<HTMLInputElement>(null);
  // Reaching the end disables the pressed button; keep keyboard focus on the turn slider, which reports the end and ignores a repeated Enter.
  const step = (value: number) => {
    playback.setPlaying(false);
    playback.setStep(value);
    if (value === max) position.current?.focus();
  };
  return (
    <>
      <button
        onClick={() => {
          if (playback.step === max) playback.setStep(0);
          playback.setPlaying(!playback.playing);
        }}
      >
        {playback.playing ? 'Pause' : playback.step === max ? 'Replay' : 'Play'}
      </button>
      <button disabled={playback.step === max} onClick={() => step(Math.min(max, playback.step + 1))}>
        Next turn
      </button>
      <button onClick={playback.reset}>Reset</button>
      <label>
        Transcript turn{' '}
        <input
          ref={position}
          type="range"
          min={0}
          max={max}
          value={playback.step}
          onChange={(event) => {
            playback.setPlaying(false);
            playback.setStep(Number(event.target.value));
          }}
        />
      </label>
      <span>
        {playback.step} / {max}
      </span>
      {full && (
        <button disabled={playback.step === max} onClick={() => step(max)}>
          Show full result
        </button>
      )}
    </>
  );
}

export function SimulatorSelectionStory() {
  const source = useCatalog();
  const [scenarioId, setScenarioId] = useState(source.scenarios[0]!.id);
  const [clientId, setClientId] = useState(source.clients[0]!.id);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const catalog = useMemo(
    () =>
      expanded
        ? {
            ...source,
            scenarios: [
              ...source.scenarios,
              ...Array.from({ length: 6 }, (_, index) => ({
                ...source.scenarios[index % 2]!,
                id: `preview-scenario-${index}`,
                title: `${source.scenarios[index % 2]!.title} · Preview ${index + 1}`,
              })),
            ],
            clients: [
              ...source.clients,
              ...Array.from({ length: 6 }, (_, index) => ({
                ...source.clients[index % 3]!,
                id: `preview-client-${index}`,
                name: `${source.clients[index % 3]!.name} ${index + 2}`,
              })),
            ],
          }
        : source,
    [source, expanded],
  );
  return (
    <>
      <div className="workshop-controls">
        <label>
          <input
            type="checkbox"
            checked={expanded}
            onChange={(event) => {
              setExpanded(event.target.checked);
              setScenarioId(source.scenarios[0]!.id);
              setClientId(source.clients[0]!.id);
            }}
          />
          Larger collection (illustrative)
        </label>
        <label>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Live available
        </label>
        <button
          onClick={() =>
            setError(error ? null : 'Microphone access was denied. Allow access in your browser, then try again.')
          }
        >
          Toggle microphone error
        </button>
      </div>
      <SimulatorClientStats clientId={clientId} />
      <SimulatorSelection
        catalog={catalog}
        scenarioId={scenarioId}
        clientId={clientId}
        onScenario={setScenarioId}
        onClient={setClientId}
        onStart={() => setError('Workshop preview: no microphone or paid session was opened.')}
        enabled={enabled}
        error={error}
      />
    </>
  );
}

export function SimulatorLiveStory() {
  const catalog = useCatalog();
  const conversations = [...simulatorFixtures.filter(item => ['earned-discovery', 'scope-tradeoff', 'scope-overpromise'].includes(item.id)), happyHourFixture];
  const [fixtureId, setFixtureId] = useState('earned-discovery');
  const fixture = conversations.find((item) => item.id === fixtureId)!;
  const playback = useReplay(fixture.transcript.length);
  const [phase, setPhase] = useState<'connecting' | 'live' | 'ending'>('live');
  const [feedback, setFeedback] = useState<'recorded' | 'delayed' | 'unavailable'>('recorded');
  const [muted, setMuted] = useState(false);
  const [hintPreview, setHintPreview] = useState('recorded');
  const [warningPreview, setWarningPreview] = useState('none');
  const { snapshot, scenario, client } = recordedAttempt(catalog, fixture, playback.step);
  snapshot.warning = warningPreview === 'none' ? null : {
    kind: warningPreview === 'finishing' ? 'limit' : warningPreview as 'idle' | 'limit' | 'capacity',
    endsAt: Date.now() + (warningPreview === 'finishing' ? -1000 : 60_000),
  };
  const hints: Record<string, string> = {
    sample: 'Ask how the document problems affect Priya’s team.',
    another: 'Find out who else needs to be involved in the next step.',
    concern: 'You made a commitment before checking the delivery impact. Clarify the boundary with the client.',
    'new-concern': 'You made another commitment before checking the delivery impact. Clarify the boundary with the client.',
    'contextual-hint': 'Priya mentioned missing approvals. Ask which decision gets delayed when that happens.',
    'contextual-concern': 'A commitment or claim may go beyond what has been established. Review it before proceeding.',
    'contextual-replacement': 'You promised a fixed delivery date. Clarify that the scope still needs estimating.',
    'contextual-expired': 'Priya mentioned missing approvals. Ask which decision gets delayed when that happens.',
  };
  const hintText = hints[hintPreview];
  const concern = ['concern', 'new-concern', 'contextual-concern', 'contextual-replacement'].includes(hintPreview);
  snapshot.coaching = hintText ? {
    id: concern ? `trainee:mistake:${hintPreview === 'new-concern' ? 2 : 1}` : hintPreview.startsWith('contextual-') ? 'hint:objective:problem' : `hint:${hintPreview}`,
    kind: concern ? 'concern' : 'hint', objectiveId: concern ? null : 'problem', text: hintText, evidenceIds: ['p1'],
    createdAt: Date.now(), expiresAt: Date.now() + (hintPreview === 'contextual-expired' ? -1000 : 30_000),
  } : null;
  if (feedback !== 'recorded') snapshot.feedbackStatus = feedback;
  if (feedback === 'unavailable') snapshot.evaluation = null;
  const speaker = snapshot.transcript.at(-1)?.speaker;
  return (
    <>
      <div className="workshop-controls">
        <label>
          Conversation
          <select
            value={fixtureId}
            onChange={(event) => {
              setFixtureId(event.target.value);
              playback.reset();
            }}
          >
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Connection
          <select value={phase} onChange={(event) => setPhase(event.target.value as typeof phase)}>
            <option value="connecting">Connecting</option>
            <option value="live">Live</option>
            <option value="ending">Ending</option>
          </select>
        </label>
        <label>
          Feedback
          <select value={feedback} onChange={(event) => setFeedback(event.target.value as typeof feedback)}>
            <option value="recorded">Recorded results</option>
            <option value="delayed">Delayed</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <Playback playback={playback} max={fixture.transcript.length} />
        <label>Hint preview<select value={hintPreview} onChange={event => setHintPreview(event.target.value)}><option value="recorded">No coaching</option><option value="sample">Sample hint</option><option value="another">Another hint</option><option value="concern">Concern</option><option value="new-concern">New concern episode</option><option value="none">No hint</option><option value="contextual-hint">Contextual hint</option><option value="contextual-concern">Immediate concern</option><option value="contextual-replacement">Specific concern</option><option value="contextual-none">Paused contextual hint</option><option value="contextual-expired">Expired contextual hint</option></select></label>
        <label>Session warning<select aria-label="Session warning" value={warningPreview} onChange={event => setWarningPreview(event.target.value)}><option value="none">None</option><option value="idle">Inactivity</option><option value="limit">One-hour limit</option><option value="capacity">Conversation capacity</option><option value="finishing">Finishing current reply</option></select></label>
      </div>
      <p className="sim-collection-note">{scenario.objectives.length ? `Recorded Jev checkpoints; illustrative audio activity${hintPreview !== 'recorded' ? ' and coaching preview' : ''}.` : 'Illustrative happy-hour conversation; no scoring.'} No live connection.</p>
      <SimulatorClientStats clientId={client.id} />
      <SimulatorConversation
        key={fixtureId}
        scenario={scenario}
        client={client}
        snapshot={phase === 'connecting' ? null : snapshot}
        phase={phase}
        muted={muted}
        levels={illustrativeLevels(playback.playing ? (speaker ?? 'listening') : 'listening', playback.step)}
        elapsed={playback.step * 12}
        onEnd={() => setPhase(phase === 'ending' ? 'live' : 'ending')}
        onMute={() => setMuted((value) => !value)}
        onAudio={() => {}}
        onContinue={() => setWarningPreview('none')}
      />
    </>
  );
}

export function SimulatorJudgingStory() {
  const catalog = useCatalog();
  const [id, setId] = useState('earned-discovery');
  const fixture = simulatorFixtures.find((item) => item.id === id)!;
  const playback = useReplay(fixture.transcript.length, 1300);
  const { snapshot, scenario, recording: row, nextRecorded } = recordedAttempt(catalog, fixture, playback.step);
  const failedChecks = row?.checks.some((check) => !check.passed) || undefined;
  return (
    <>
      <div className="workshop-controls">
        <label>
          Authored transcript
          <select
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              playback.reset();
            }}
          >
            {simulatorFixtures.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <Playback playback={playback} max={fixture.transcript.length} full />
      </div>
      <div className="sim-lab">
        <header className="sim-lab-heading">
          <span className="eyebrow">RECORDED JEV ANALYSIS</span>
          <h1>{fixture.title}</h1>
          <p>{fixture.description}</p>
        </header>
        <p className="sim-lab-checkpoint">
          {row
            ? `Evidence through turn ${row.transcriptLength} · Synthetic dialogue`
            : `No recording at this turn. ${nextRecorded ? `Next recorded checkpoint: turn ${nextRecorded}.` : 'Advance to a recorded checkpoint.'}`}
        </p>
        {row && (
          <details className="sim-lab-source">
            <summary>Recording details</summary>
            <p className="sim-lab-provenance">
              {row.trainee.model} · {row.source.rubricVersion} · {row.source.collectedAt.slice(0, 10)} ·{' '}
              {row.source.file}
              <br />
              Trainee {row.trainee.durationMs} ms · Client {row.client.durationMs} ms
            </p>
          </details>
        )}
        <div className="sim-lab-grid">
          <div>
            <h3 className="sim-lab-column-title">Conversation evidence</h3>
            <SimulatorTranscript entries={snapshot.transcript} />
            {row ? (
              <details className="sim-lab-check-details" key={id} open={failedChecks} data-failed={failedChecks}>
                <summary>{`${row.checks.filter((check) => check.passed).length} of ${row.checks.length} checks passed`}</summary>
                <div className="sim-lab-checks">
                  {row.checks.map((check) => (
                    <span key={check.name} className={check.passed ? '' : 'failed'}>
                      {check.passed ? '✓' : '×'} {check.name}
                    </span>
                  ))}
                </div>
              </details>
            ) : (
              <p className="sim-lab-check-details">No checks at this turn</p>
            )}
          </div>
          <div>
            <h3 className="sim-lab-column-title">Trainee assessment</h3>
            <SimulatorObjectives scenario={scenario} evaluation={snapshot.evaluation} />
            <SimulatorSkills evaluation={snapshot.evaluation} status={snapshot.feedbackStatus} recorded />
          </div>
        </div>
        {row && (
          <details className="sim-debrief-transcript">
            <summary>Inspect raw typed judgments and distributions</summary>
            <pre className="sim-raw-judgments">
              {JSON.stringify({ trainee: row.trainee.answers, client: row.client.answers }, null, 2)}
            </pre>
          </details>
        )}
        <p className="sim-lab-provenance">
          These are historical rubric recordings. New <code>bun run eval:simulator</code> results are written under <code>output/</code>.
          Opening this lab performs no provider calls.
        </p>
      </div>
    </>
  );
}
