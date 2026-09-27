import { useRef, useState } from 'react';
import { NavLink, useLoaderData, useParams } from 'react-router';
import { GameHeader } from '../ui/game-header';
import { DrawStory, GalleryStory, ReelStory } from '../storybook/selection-stories';
import { GaugeStory, JudgingStory, RaceStory } from '../storybook/reading-stories';
import { PerformanceStory, ResultStory } from '../storybook/performance-stories';
import '../storybook/workshop.css';
import { SimulatorVoiceStory } from '../storybook/simulator-voice-story';
import { clients, publicCatalog } from '../../ai/simulator/scenarios.server';
import { SimulatorDebriefStory, SimulatorJudgingStory, SimulatorLiveStory, SimulatorSelectionStory } from '../storybook/simulator-stories';
import { VoiceLabContent } from '../simulator/voice-lab';
import { SimulatorBriefing } from '../simulator/briefing';
import { scenarioBriefings } from '../../core/simulator/briefings';
import { InterviewLiveStory, InterviewSetupStory, InterviewSummaryStory } from '../storybook/interview-stories';
import { InterviewJudgingStory } from '../storybook/interview-judging-story';

export const loader = () => ({
  simulatorCatalog: publicCatalog(),
  workshopClientStats: clients.map(({ id, name, stats }) => ({ id, name, stats })),
  defaultVoices: Object.fromEntries(clients.map(({ id, voice }) => [id, voice])),
});

export const meta = () => [{ title: 'The Workshop — Out of Character' }];
function SimulatorVoiceLabStory() {
  const { simulatorCatalog, defaultVoices } = useLoaderData<typeof loader>();
  return <VoiceLabContent clients={simulatorCatalog.clients} defaultVoices={defaultVoices} />;
}
function SimulatorBriefingStory() {
  const { simulatorCatalog } = useLoaderData<typeof loader>();
  const [scenarioId, setScenarioId] = useState(simulatorCatalog.scenarios[0]!.id);
  const [clientId, setClientId] = useState(simulatorCatalog.clients[0]!.id);
  const [notice, setNotice] = useState('');
  const [enabled, setEnabled] = useState(true);
  const scenario = simulatorCatalog.scenarios.find(item => item.id === scenarioId)!;
  const client = simulatorCatalog.clients.find(item => item.id === clientId)!;
  return <>
    <div className="workshop-controls">
      <label>Scenario<select value={scenarioId} onChange={event => { setScenarioId(event.target.value); setNotice(''); }}>{simulatorCatalog.scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Client<select value={clientId} onChange={event => { setClientId(event.target.value); setNotice(''); }}>{simulatorCatalog.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Live practice available</label>
      {notice && <p role="status">{notice}</p>}
    </div>
    <SimulatorBriefing key={`${scenarioId}:${clientId}`} scenario={scenario} client={client} briefing={scenarioBriefings[scenarioId]!} enabled={enabled} onBack={() => setNotice('Workshop preview: return to selection.')} onStart={() => setNotice('Workshop preview: no microphone or paid session was opened.')} />
  </>;
}
const stories = [
  { id: 'simulator-selection', label: 'Simulator selection', description: 'Scenario scrolling, client rail, selection transitions, availability, and microphone errors.', component: SimulatorSelectionStory },
  { id: 'simulator-briefing', label: 'Simulator briefing', description: 'Prerecorded scenario introduction, audio controls, readable transcript, and start gesture without a live session.', component: SimulatorBriefingStory },
  { id: 'simulator-live', label: 'Simulator conversation', description: 'The production screen with overlay hints, session brief, transcript, objective completions, skill bars, and connection states.', component: SimulatorLiveStory },
  { id: 'simulator-voice', label: 'Simulator audio', description: 'Replay every speaking, listening, overlap, muted, and connection state. Adjust intensity without a microphone.', component: SimulatorVoiceStory },
  { id: 'simulator-voice-lab', label: 'Voice Lab', description: 'Hear prepared voice clips for each client while viewing their portrait and personality.', component: SimulatorVoiceLabStory },
  { id: 'simulator-debrief', label: 'Simulator debrief', description: 'Successful and difficult attempts, real evidence, skill gaps, and unconfirmed finalization.', component: SimulatorDebriefStory },
  { id: 'simulator-judging', label: 'Simulator Jev lab', description: 'Authored transcripts, measured trainee judgments, client interests and fidelity, cue selection, and raw probabilities.', component: SimulatorJudgingStory },
  { id: 'interview-setup', label: 'The Debrief setup', description: 'Voice choice and private transcript notice. Start is a safe preview without a microphone.', component: InterviewSetupStory },
  { id: 'interview-live', label: 'The Debrief live', description: 'Synthetic conversation, live observations, topic threads, mute and transcript states.', component: InterviewLiveStory },
  { id: 'interview-summary', label: 'The Debrief summary', description: 'Synthetic internal summary, pending and unavailable states, copy and transcript access.', component: InterviewSummaryStory },
  { id: 'interview-judging', label: 'The Debrief analysis', description: 'Recorded Jev readings, participant evidence, heard topics, and private interviewer cue from synthetic fixtures.', component: InterviewJudgingStory },
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
  const [screenOnly, setScreenOnly] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const Story = story?.component;
  return <div className={`workshop-shell ${screenOnly ? 'screen-only' : ''}`}><GameHeader workshop simulator={screenOnly && (slug.startsWith('simulator-') || slug.startsWith('interview-'))} interview={screenOnly && slug.startsWith('interview-')}>{screenOnly && <button className="workshop-return" onClick={() => setScreenOnly(false)} aria-label="Back to workshop controls">Workshop</button>}</GameHeader><div className="workshop-layout"><aside className="workshop-sidebar"><span className="eyebrow">THE WORKSHOP</span><h1>Try every part.</h1><p>Repeatable previews. No microphone or paid requests.</p><nav aria-label="Component previews">{stories.map(item => <NavLink key={item.id} to={`/storybook/${item.id}`} className={() => slug === item.id ? 'active' : ''}>{item.label}<span>↗</span></NavLink>)}</nav><a className="workshop-report-link" href="/storybook/judging">View recorded experiment</a></aside><main className="workshop-main"><header className="workshop-heading"><div><span className="eyebrow">FIXTURE PREVIEW</span><h2>{story?.label ?? 'Unknown preview'}</h2><p>{story?.description ?? 'Choose a preview from the navigation.'}</p></div><div className="workshop-viewports"><label>Preview width<select value={viewport} onChange={event => setViewport(event.target.value)}><option value="fit">Fit available space</option><option value="1280">1280 px</option><option value="1440">1440 px</option></select></label><button onClick={() => { void preview.current?.requestFullscreen?.(); }}>Full screen</button><button onClick={() => setScreenOnly(true)}>Screen only</button></div></header><div className="workshop-preview-scroll" ref={preview}><div className="workshop-preview" style={{ width: viewport === 'fit' ? '100%' : `${viewport}px` }}>{Story && <Story key={slug} />}</div></div></main></div></div>;
}
