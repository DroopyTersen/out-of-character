import { useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { GameHeader } from '../ui/game-header';
import { DrawStory, GalleryStory, ReelStory } from '../storybook/selection-stories';
import { GaugeStory, JudgingStory, RaceStory } from '../storybook/reading-stories';
import { PerformanceStory, ResultStory } from '../storybook/performance-stories';
import '../storybook/workshop.css';
import { publicCatalog } from '../../ai/simulator/scenarios.server';
import { SimulatorDebriefStory, SimulatorJudgingStory, SimulatorLiveStory, SimulatorSelectionStory } from '../storybook/simulator-stories';

export const loader = () => ({ simulatorCatalog: publicCatalog() });

export const meta = () => [{ title: 'The Workshop — Out of Character' }];
const stories = [
  { id: 'simulator-selection', label: 'Simulator selection', description: 'Scenario scrolling, client rail, selection transitions, availability, and microphone errors.', component: SimulatorSelectionStory },
  { id: 'simulator-live', label: 'Simulator conversation', description: 'The production screen with replayable hints, objective completions, skill bars, captions, and connection states.', component: SimulatorLiveStory },
  { id: 'simulator-debrief', label: 'Simulator debrief', description: 'Successful and difficult attempts, real evidence, skill gaps, and unconfirmed finalization.', component: SimulatorDebriefStory },
  { id: 'simulator-judging', label: 'Simulator Jev lab', description: 'Authored transcripts, measured trainee judgments, client interests and fidelity, cue selection, and raw probabilities.', component: SimulatorJudgingStory },
  { id: 'draw', label: 'Complete draw', description: 'Idle, landing, scene timing, failure, and connection states.', component: DrawStory },
  { id: 'reel', label: 'Character reel', description: 'Replay the actual reel with a chosen landing character.', component: ReelStory },
  { id: 'gallery', label: 'Character gallery', description: 'All 42 personas, backstories, judge-facing descriptions, and individual artwork.', component: GalleryStory },
  { id: 'gauge', label: 'Gauge and streak', description: 'Composite readings, display rounding, paused speech, and score streaks.', component: GaugeStory },
  { id: 'race', label: 'Character race', description: 'Ranking changes, ties, low matches, target visibility, and expansion.', component: RaceStory },
  { id: 'performance', label: 'Performance screen', description: 'Timed fresh-speech and silence replays with real game components.', component: PerformanceStory },
  { id: 'result', label: 'Result screen', description: 'Final top 10, the full transcript, character highlights, and outcome states.', component: ResultStory },
  { id: 'judging', label: 'Judging comparison', description: '70/30 composite demo with a 20-second recent window and recorded Noul/Score answers on 18 synthetic transcripts.', component: JudgingStory },
];

export default function Storybook() {
  const slug = useParams()['*']?.split('/')[0] || 'draw';
  const story = stories.find(item => item.id === slug);
  const [viewport, setViewport] = useState('fit');
  const preview = useRef<HTMLDivElement>(null);
  const Story = story?.component;
  return <div className="workshop-shell"><GameHeader workshop /><div className="workshop-layout"><aside className="workshop-sidebar"><span className="eyebrow">THE WORKSHOP</span><h1>Try every part.</h1><p>Repeatable previews. No microphone or paid requests.</p><nav aria-label="Component previews">{stories.map(item => <NavLink key={item.id} to={`/storybook/${item.id}`} className={() => slug === item.id ? 'active' : ''}>{item.label}<span>↗</span></NavLink>)}</nav><a className="workshop-report-link" href="/storybook/judging">View recorded experiment</a></aside><main className="workshop-main"><header className="workshop-heading"><div><span className="eyebrow">FIXTURE PREVIEW</span><h2>{story?.label ?? 'Unknown preview'}</h2><p>{story?.description ?? 'Choose a preview from the navigation.'}</p></div><div className="workshop-viewports"><label>Preview width<select value={viewport} onChange={event => setViewport(event.target.value)}><option value="fit">Fit available space</option><option value="1280">1280 px</option><option value="1440">1440 px</option></select></label><button onClick={() => { void preview.current?.requestFullscreen?.(); }}>Full screen</button></div></header><div className="workshop-preview-scroll" ref={preview}><div className="workshop-preview" style={{ width: viewport === 'fit' ? '100%' : `${viewport}px` }}>{Story && <Story key={slug} />}</div></div></main></div></div>;
}
