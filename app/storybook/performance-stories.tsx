import { useEffect, useState } from 'react';
import { acceptReading, emptyStreak, type WordSegment } from '../../core/performance';
import { PerformanceScreen } from '../ui/performance-screen';
import { ResultScreen } from '../ui/result-screen';
import { characters } from '../../core/characters';
import { transcriptPassages, type HighlightState } from '../../core/highlights';
import { CharacterPicker, characterFor, defaultCharacter, sampleScenes, savedComparison, savedReadings } from './shared';

const positive = savedComparison.rows.find(row => row.id === 'architecture' && row.mode === 'noul')!;
const spokenChunks = positive.transcript.split(/(?<=[.!?])\s+/);

export function PerformanceStory() {
  const [scenario, setScenario] = useState('sustained');
  const [second, setSecond] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => { if (second >= 14) setPlaying(false); else setSecond(second + 1); }, 1000);
    return () => clearTimeout(timer);
  }, [playing, second]);
  let streak = emptyStreak();
  const segments: WordSegment[] = [];
  for (let now = 0; now <= second; now++) {
    if (scenario === 'silence' && now > 2) continue;
    segments.push({ id: `fixture-${now}`, text: spokenChunks[now % spokenChunks.length]!, start: now, end: now, final: true });
    streak = acceptReading(streak, positive.readings['architecture-astronaut'], now);
  }
  const silence = scenario === 'silence' && second > 5;
  return <><div className="workshop-controls"><label>Timed scenario<select value={scenario} onChange={event => { setScenario(event.target.value); setSecond(0); setPlaying(false); }}><option value="sustained">Continuing fresh speech → win</option><option value="silence">Strong opening → pause keeps scores and streak</option></select></label><button onClick={() => { setSecond(0); setPlaying(true); }}>Replay 15 seconds</button><button onClick={() => setPlaying(false)} disabled={!playing}>Pause</button><label>Time: {second}s<input type="range" min="0" max="14" step="1" value={second} onChange={event => { setPlaying(false); setSecond(Number(event.target.value)); }} /></label></div><div className="workshop-stage"><PerformanceScreen character={defaultCharacter} scene={sampleScenes[0]!} readings={positive.readings} progress={streak.count} segments={segments} level={playing && !silence ? .07 : 0} status={silence ? 'Keep talking — waiting for fresh speech' : streak.won ? 'Fixture win: ten qualifying scores in a row' : 'That’s the character. Keep the streak going!'} /></div><p className="workshop-note">Clock: {second}s. {streak.won ? 'Won on a fresh reading.' : silence ? 'Paused at three scores. Pauses do not add scores or reset the streak.' : 'Each accepted qualifying score advances the streak.'} Timed captions are authored fixtures; reading frames reuse one saved judgment to demonstrate streak behavior.</p></>;
}

export function ResultStory() {
  const [id, setId] = useState(defaultCharacter.id as string);
  const [won, setWon] = useState(true);
  const [rival, setRival] = useState(true);
  const [elapsed, setElapsed] = useState(26);
  const [again, setAgain] = useState(false);
  const [reviewMode, setReviewMode] = useState('ready');
  const peaks = { ...savedReadings(), [id]: .96, 'scrum-cop': rival && id !== 'scrum-cop' ? .72 : .03 };
  const transcript = reviewMode === 'empty' ? '' : 'Thanks for making time for this meeting. The client asked for one checkout button by Friday. Before we build anything, I need fourteen services, a gateway, and a diagram of every event crossing every boundary.\n\nThe working screen can wait until everyone has approved my reference architecture. I know the prototype already works, but that is no reason to skip another design workshop. Let us look at these arrows again.';
  const highlights: HighlightState = ['loading', 'error', 'empty'].includes(reviewMode)
    ? { status: reviewMode as 'loading' | 'error' | 'empty' }
    : { status: 'ready', review: { exists: reviewMode === 'none' ? .12 : .96, passages: transcriptPassages(transcript).map((passage, index) => ({ ...passage, relevance: [.03, .02, .47, .31, .15, .02][index] ?? 0 })) } };
  const readings = reviewMode === 'empty' ? {} : { ...Object.fromEntries(characters.map((character, index) => [character.id, Math.max(.01, .76 - index * .045)])), [id]: reviewMode === 'outside' ? .01 : .89 };
  return <><div className="workshop-controls"><CharacterPicker value={id} onChange={setId} /><label className="workshop-check"><input type="checkbox" checked={won} onChange={event => setWon(event.target.checked)} /> Won</label><label className="workshop-check"><input type="checkbox" checked={rival} onChange={event => setRival(event.target.checked)} /> Rival highlight</label><label>Elapsed: {elapsed}s<input type="range" min="10" max="180" step="1" value={elapsed} onChange={event => setElapsed(Number(event.target.value))} /></label><label>Transcript preview<select value={reviewMode} onChange={event => setReviewMode(event.target.value)}><option value="ready">Strong character moments</option><option value="none">No clear matches</option><option value="loading">Finding highlights</option><option value="error">Highlights unavailable</option><option value="empty">No speech or scores</option><option value="outside">Target outside top 10</option></select></label></div><ResultScreen character={characterFor(id)} won={won} elapsed={elapsed} peaks={rival ? peaks : { [id]: .96 }} readings={readings} transcript={transcript} highlights={highlights} onRetryHighlights={() => setReviewMode('ready')} onAgain={() => setAgain(value => !value)} /><p className="workshop-note" role="status">{again ? 'Draw again action received by the fixture.' : 'Illustrative scores and highlights. This preview makes no paid requests.'}</p></>;
}
