import { useEffect, useState } from 'react';
import { combineReadings } from '../../core/performance';
import { characters } from '../../core/characters';
import { CharacterRace } from '../ui/character-race';
import { TargetGauge } from '../ui/target-gauge';
import { CharacterPicker, characterFor, defaultCharacter, savedComparison, savedReadings } from './shared';

export function GaugeStory() {
  const [value, setValue] = useState(.799);
  const [progress, setProgress] = useState(0);
  const [stale, setStale] = useState(false);
  const [waiting, setWaiting] = useState(false);
  return <><div className="workshop-controls"><label>Raw composite: {value.toFixed(3)}<input type="range" min="0" max="1" step=".001" value={value} onChange={event => setValue(Number(event.target.value))} /></label><label>Streak: {progress} scores<input type="range" min="0" max="10" step="1" value={progress} onChange={event => setProgress(Number(event.target.value))} /></label><label className="workshop-check"><input type="checkbox" checked={waiting} onChange={event => setWaiting(event.target.checked)} /> Waiting for first reading</label><label className="workshop-check"><input type="checkbox" checked={stale} onChange={event => setStale(event.target.checked)} /> Paused speech</label><button onClick={() => setValue(.799)}>0.799</button><button onClick={() => setValue(.8)}>0.800</button></div><div className="arcade-panel workshop-gauge"><TargetGauge value={waiting ? null : value} progress={progress} stale={stale} /><p className="workshop-note">Raw composite {value.toFixed(3)}: {value >= .8 ? 'qualifies for the win zone' : 'below the 0.80 threshold'}. Display rounding does not change qualification.</p></div></>;
}

function CompositeDemo() {
  const [full, setFull] = useState(.84);
  const [recent, setRecent] = useState(.76);
  const composite = combineReadings(full, recent);
  return <section className="arcade-panel workshop-composite" aria-labelledby="composite-heading">
    <div><span className="eyebrow">70 / 30 COMPOSITE</span><h2 id="composite-heading">Two readings. One match.</h2><p className="workshop-note">For each character, the full performance and the last 20 seconds receive separate Noul probabilities. Their weighted score (70% full performance, 30% recent speech) drives the live gauge, ranking, and win threshold.</p>
      <div className="workshop-controls"><label>Full performance probability · {full.toFixed(3)}<input aria-label="Full performance probability" type="range" min="0" max="1" step=".001" value={full} onChange={event => setFull(Number(event.target.value))} /></label><label>Last 20 seconds probability · {recent.toFixed(3)}<input aria-label="Last 20 seconds probability" type="range" min="0" max="1" step=".001" value={recent} onChange={event => setRecent(Number(event.target.value))} /></label></div>
      <output className="workshop-composite-mean" aria-label="Composite arithmetic" aria-live="polite">({full.toFixed(3)} × 70%) + ({recent.toFixed(3)} × 30%) = <strong>{composite.toFixed(4)}</strong></output>
      <p className="workshop-note">Illustrative controls, not measured dual-context recordings. The saved examples below retain their recorded single-context results.</p>
    </div><div className="workshop-composite-gauge"><TargetGauge value={composite} progress={0} /><p className="workshop-note">Composite {composite.toFixed(4)}: {composite >= .8 ? 'qualifies for the win zone' : 'below the 0.80 threshold'}.</p></div>
  </section>;
}

const architecture = savedReadings();
const scrum = savedReadings('scrum');
const multiply = (readings: Record<string, number>, factor: number) => Object.fromEntries(Object.entries(readings).map(([id, value]) => [id, value * factor]));
const replayFrames = [multiply(architecture, .2), multiply(architecture, .55), architecture, multiply(scrum, .55), scrum];

export function RaceStory() {
  const [id, setId] = useState(defaultCharacter.id as string);
  const [kind, setKind] = useState('replay');
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => { if (frame === replayFrames.length - 1) setPlaying(false); else setFrame(frame + 1); }, 1000);
    return () => clearTimeout(timer);
  }, [playing, frame]);
  const readings = kind === 'empty' ? {} : kind === 'low' ? Object.fromEntries(characters.map(character => [character.id, .02])) : kind === 'ties' ? Object.fromEntries(characters.map((character, index) => [character.id, index < 16 ? .82 : .03])) : replayFrames[frame]!;
  return <><div className="workshop-controls"><CharacterPicker value={id} onChange={setId} /><label>Readings<select aria-label="Readings" value={kind} onChange={event => { setKind(event.target.value); setPlaying(false); }}><option value="replay">Architecture → Scrum replay</option><option value="empty">Waiting for first reading</option><option value="low">All below 5%</option><option value="ties">Ties and many high matches</option></select></label><button disabled={kind !== 'replay'} onClick={() => { setFrame(0); setPlaying(true); }}>Replay frames</button><label>Frame {frame + 1} / {replayFrames.length}<input type="range" min="0" max={replayFrames.length - 1} step="1" value={frame} onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }} /></label></div><div className="workshop-race"><CharacterRace readings={readings} targetId={id} live={playing} /></div><p className="workshop-note">Use the component’s “Rest of the cast” control to inspect all 42 entries. The selected target remains visible among the leaders.</p></>;
}

const transcriptIds = [...new Set(savedComparison.rows.map(row => row.id))];

export function JudgingStory() {
  const [id, setId] = useState(transcriptIds[0]!);
  const [mode, setMode] = useState('noul');
  const row = savedComparison.rows.find(item => item.id === id && item.mode === mode)!;
  const target = 'expected' in row && row.expected ? characterFor(row.expected) : null;
  const limitation = id === 'opposite' ? mode === 'score' ? 'Known false match: ordinary pragmatic engineering advice scored 0.89 for The Magic-Only Buyer. Score is a comparison tool, not a validated gameplay mode.' : 'Boundary case: ordinary pragmatic engineering advice reached 0.76 for The Magic-Only Buyer. This single-context recording is not a composite gameplay reading.' : '';
  const ranked = characters.map(character => ({ character, value: (row.readings as Record<string, number>)[character.id]! })).sort((a, b) => b.value - a.value || a.character.id.localeCompare(b.character.id));
  return <><CompositeDemo /><div className="workshop-controls"><label>Saved transcript<select value={id} onChange={event => setId(event.target.value)}>{transcriptIds.map(value => <option key={value} value={value}>{value.replaceAll('-', ' ')}</option>)}</select></label><label>Judgment<select aria-label="Judgment" value={mode} onChange={event => setMode(event.target.value)}><option value="noul">Noul · probability of match</option><option value="score">Score · portrayal intensity</option></select></label></div><div className="workshop-judging"><section className="arcade-panel workshop-evidence"><span className="eyebrow">SAVED SYNTHETIC PERFORMANCE · {row.split.toUpperCase()}</span><h2>{target?.name ?? 'Negative example: no intended persona'}</h2><blockquote>{row.transcript}</blockquote><p className="workshop-note">{mode === 'noul' ? 'Noul is P(this persona is enacted). Independent probabilities do not sum to one.' : 'Score is the expected position across five portrayal levels, divided by four. It is intensity, not P(match); the composite gameplay threshold does not transfer.'}</p>{limitation && <p className="workshop-note workshop-limitation">{limitation}</p>}<dl className="workshop-metadata"><div><dt>Provider time</dt><dd>{row.durationMs} ms</dd></div><div><dt>Input tokens</dt><dd>{row.usage.inputTokens.toLocaleString('en-US')}</dd></div><div><dt>Model</dt><dd>{row.model}</dd></div><div><dt>Questions</dt><dd>{row.judgingVersion}</dd></div><div><dt>Recorded</dt><dd>{savedComparison.collectedAt.slice(0, 10)}</dd></div></dl><p className="workshop-note">These are recorded provider answers on authored fixtures. Changing controls makes no provider requests.</p></section><section className="arcade-panel workshop-values"><h2>All 42 independent readings</h2><table><thead><tr><th scope="col">Rank / character</th><th scope="col">{mode === 'noul' ? 'P(match)' : 'Score / 4'}</th></tr></thead><tbody>{ranked.map(({ character, value }, index) => <tr key={character.id} className={character.id === target?.id ? 'target' : ''}><td><span>{index + 1}.</span> {character.name}{character.id === target?.id && <small> EXPECTED</small>}</td><td>{value.toFixed(mode === 'noul' ? 2 : 4)}</td></tr>)}</tbody></table></section></div></>;
}
