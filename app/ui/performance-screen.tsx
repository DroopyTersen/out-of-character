import { Mic } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Character } from "../../core/characters";
import type { WordSegment } from "../../core/performance";
import { CharacterArt } from "./character-art";
import { TargetGauge } from "./target-gauge";
import { CharacterRace } from "./character-race";
import { Transcription } from "../ai-elements/transcription";

export function PerformanceScreen({ character, scene, readings, progress, segments, level, status, readingCurrent = true }: { character: Character; scene: string; readings: Record<string, number>; progress: number; segments: WordSegment[]; level: number; status: string; readingCurrent?: boolean }) {
  const captions = useRef<HTMLDivElement>(null);
  useEffect(() => { if (captions.current) captions.current.scrollTop = captions.current.scrollHeight; }, [segments]);
  const stale = !readingCurrent || status.toLowerCase().includes("fresh speech");
  return <div className="performance-layout"><div className="performance-panels"><section className="arcade-panel character-stage"><h1>{character.name.replace(/^The /, "")}</h1><p className="stage-backstory">{character.backstory.replace(/[*`]/g, "")}</p><div className="stage-art"><span className="spark one">+</span><CharacterArt character={character} /><span className="spark two">+</span></div><div className="stage-scene"><span className="eyebrow">YOUR SCENE</span><p>{scene}</p></div><TargetGauge value={readings[character.id] ?? null} progress={progress} stale={stale} /></section>
      <CharacterRace readings={readings} targetId={character.id} live={!stale && Object.keys(readings).length > 0} />
    </div><div className="arcade-panel captions-panel"><div className="caption-label"><Mic size={24} /><span>CAPTIONS</span><i style={{ opacity: Math.max(0.15, Math.min(1, level * 8)) }} /></div><div className="captions-scroll" ref={captions} aria-live="off">
      {segments.length ? <Transcription segments={segments.map(segment => ({ text: segment.text, startSecond: segment.start, endSecond: segment.end }))}>{(segment, index) => <span className={segments[index]?.final ? "" : "partial-caption"} key={`${segment.startSecond}-${index}`}>{segment.text}{" "}</span>}</Transcription> : <p className="caption-placeholder">Your performance starts with your first words…</p>}
    </div></div><p className="performance-status" role="status">{status}</p></div>;
}
