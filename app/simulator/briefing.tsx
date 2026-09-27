import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { Client, ScenarioSummary } from '../../core/simulator/types';
import type { ScenarioBriefing } from '../../core/simulator/briefings';
import './briefing.css';

function playbackTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function SimulatorBriefing({ scenario, client, briefing, onBack, onStart, enabled = true }: {
  scenario: ScenarioSummary;
  client: Client;
  briefing: ScenarioBriefing;
  onBack: () => void;
  onStart: () => void;
  enabled?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    // A shared page may load audio metadata before React attaches event handlers.
    if (Number.isFinite(player.duration)) setDuration(player.duration);
    if (player.error) setFailed(true);
    // Selection provides a user gesture; shared links may need the Play intro button.
    void player.play().catch(error => {
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') setFailed(true);
    });
    return () => { player.pause(); };
  }, [briefing.audio]);

  const togglePlayback = () => {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) { player.pause(); return; }
    if (player.ended) player.currentTime = 0;
    void player.play().catch(error => {
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') setFailed(true);
    });
  };
  const leave = (action: () => void) => {
    audio.current?.pause();
    action();
  };

  const IntroIcon = failed ? VolumeX : Volume2;

  return <section className="sim-briefing" aria-labelledby="sim-briefing-title">
    <button className="sim-briefing-back quiet-button" onClick={() => leave(onBack)}><ArrowLeft size={16} /> Change scenario or client</button>
    <header className="sim-briefing-heading">
      <h1 id="sim-briefing-title" tabIndex={-1}>Before you meet {client.name}</h1>
      <div className="sim-briefing-context"><strong>{scenario.title}</strong><div className="sim-briefing-roles"><span>You: {scenario.role}</span><span>{client.name}: {scenario.clientRole}</span></div></div>
    </header>
    <div className="sim-briefing-steps">
      <div className="sim-briefing-card">
        <div className="sim-briefing-step-heading" data-unavailable={failed || undefined}><IntroIcon size={28} strokeWidth={1.75} aria-hidden="true" /><h2 aria-live="polite">{failed ? 'Intro unavailable' : finished ? 'Intro complete' : 'Listen first'}</h2></div>
        <audio ref={audio} preload="metadata" src={briefing.audio} hidden
          onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
          onPause={() => setPlaying(false)} onPlaying={() => { setPlaying(true); setFailed(false); }}
          onError={() => { setPlaying(false); setFailed(true); }} onEnded={() => { setPlaying(false); setFinished(true); }} />
        {failed ? <p className="sim-briefing-error" role="status">The intro couldn’t load. Try refreshing the page.</p> : <>
          <button className={`sim-briefing-play arcade-button ${finished ? 'secondary' : 'primary'}`} onClick={togglePlayback}>
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />} {playing ? 'Pause intro' : 'Play intro'}
          </button>
          <div className="sim-briefing-progress">
            <span>{playbackTime(position)}</span>
            <input type="range" aria-label="Intro playback position" aria-valuetext={`${playbackTime(position)} of ${playbackTime(duration)}`} style={{ '--intro-progress': `${duration ? position / duration * 100 : 0}%` } as CSSProperties} min={0} max={duration || 1} step={1} value={position} disabled={!duration} onChange={event => {
              const nextPosition = Number(event.target.value);
              setPosition(nextPosition);
              if (audio.current) audio.current.currentTime = nextPosition;
            }} />
            <span>{duration ? playbackTime(duration) : '—:—'}</span>
          </div>
        </>}
      </div>
      <div className="sim-briefing-bottom">
        <div className="sim-briefing-step-heading"><AudioLines size={28} strokeWidth={1.75} aria-hidden="true" /><h2>Start your meeting</h2></div>
        <button className={`arcade-button ${finished || failed ? 'primary' : 'secondary'}`} disabled={!enabled} onClick={() => leave(onStart)}>Start meeting <ArrowRight size={20} /></button>
      </div>
    </div>
    {!enabled && <p className="sim-notice">Live practice is currently unavailable. Explore the <a href="/storybook/simulator-live">workshop previews</a>.</p>}
  </section>;
}
