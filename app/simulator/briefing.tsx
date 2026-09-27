import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Link as LinkIcon, RotateCcw, Volume2 } from 'lucide-react';
import type { Client, ScenarioSummary } from '../../core/simulator/types';
import type { ScenarioBriefing } from '../../core/simulator/briefings';
import { practicePath } from './practice-links';
import './briefing.css';

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
  const [finished, setFinished] = useState(false);
  const [share, setShare] = useState<{ url: string; copied: boolean } | null>(null);

  const copyLink = async () => {
    const url = new URL(practicePath(scenario.id, client.id), window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setShare({ url, copied: true });
    } catch {
      setShare({ url, copied: false });
    }
  };

  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    void player.play().catch(error => {
      // Browsers may require a play gesture; native audio controls remain available.
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') setFailed(true);
    });
    return () => { player.pause(); };
  }, [briefing.audio]);

  const replay = () => {
    const player = audio.current;
    if (!player) return;
    player.currentTime = 0;
    setFinished(false);
    void player.play().catch(error => {
      if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') setFailed(true);
    });
  };
  const leave = (action: () => void) => {
    audio.current?.pause();
    action();
  };

  return <section className="sim-briefing" aria-labelledby="sim-briefing-title">
    <div className="sim-briefing-actions">
      <button className="sim-briefing-back quiet-button" onClick={() => leave(onBack)}><ArrowLeft size={16} /> Change scenario or client</button>
      <button className="sim-briefing-share quiet-button" onClick={copyLink} aria-label={share?.copied ? 'Link copied' : 'Copy link'} title="Copy a link to this practice">{share?.copied ? <Check size={16} /> : <LinkIcon size={16} />}<span>{share?.copied ? 'Link copied' : 'Copy link'}</span></button>
    </div>
    <span className="sr-only" role="status">{share && (share.copied ? 'Link copied.' : 'Copy the practice link below.')}</span>
    {share && !share.copied && <label className="sim-briefing-copy-fallback">Copy this practice link:<input aria-label="Practice link" readOnly value={share.url} onFocus={event => event.target.select()} /></label>}
    <header className="sim-briefing-heading">
      <span className="eyebrow">YOUR BRIEFING · {scenario.category.toUpperCase()}</span>
      <h1 id="sim-briefing-title" tabIndex={-1}>Before you meet {client.name}</h1>
      <p>A quick note from your team before the conversation begins.</p>
    </header>
    <div className="sim-briefing-card">
      <div className="sim-briefing-art" aria-hidden="true"><Volume2 size={50} strokeWidth={1.5} /><span className="sim-briefing-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span></div>
      <div className="sim-briefing-content">
        <span className="eyebrow">PRERECORDED MESSAGE</span>
        <h2>{briefing.speaker}</h2>
        <p className="sim-briefing-intro">Listen for the situation and your role. Start the live call when you are ready.</p>
        <audio ref={audio} controls preload="metadata" src={briefing.audio} aria-label={`Briefing from ${briefing.speaker}`} hidden={failed} onError={() => setFailed(true)} onEnded={() => setFinished(true)} onPlaying={() => { setFailed(false); setFinished(false); }} />
        <div className="sim-briefing-audio-foot">
          <span role="status">{failed ? 'Audio unavailable. You can read the transcript below.' : finished ? 'Briefing complete. Start when you are ready.' : 'Play the note, then start whenever you are ready.'}</span>
          {!failed && <button className="quiet-button" onClick={replay}><RotateCcw size={15} /> Replay</button>}
        </div>
      </div>
    </div>
    <div className="sim-briefing-bottom">
      <div className="sim-briefing-context"><span className="eyebrow">UP NEXT</span><strong>{scenario.title}</strong><span>{scenario.role} meeting {client.name} · {scenario.clientRole}</span></div>
      <button className="arcade-button primary" disabled={!enabled} onClick={() => leave(onStart)}>Start conversation <ArrowRight size={20} /></button>
    </div>
    {!enabled && <p className="sim-notice">Live practice is currently unavailable. Explore the <a href="/storybook/simulator-live">workshop previews</a>.</p>}
    <details className="sim-briefing-transcript" open={failed}><summary>Read briefing transcript</summary><p>{briefing.text}</p></details>
  </section>;
}
