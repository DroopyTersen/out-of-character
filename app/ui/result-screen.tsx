import { ArrowRight, RotateCcw, Trophy } from "lucide-react";
import { characters, type Character } from "../../core/characters";
import { formatElapsed } from "../../core/performance";
import type { HighlightState } from "../../core/highlights";
import { CharacterArt } from "./character-art";
import { CharacterRace } from "./character-race";
import { TranscriptReview } from "./transcript-review";

export function ResultScreen({ character, won, elapsed, peaks, readings, transcript, highlights, onRetryHighlights, onAgain }: {
  character: Character; won: boolean; elapsed: number; peaks: Record<string, number>;
  readings: Record<string, number>; transcript: string; highlights: HighlightState;
  onRetryHighlights?: () => void; onAgain: () => void;
}) {
  const rival = characters.filter(item => item.id !== character.id && (peaks[item.id] ?? 0) >= 0.5).sort((a, b) => (peaks[b.id] ?? 0) - (peaks[a.id] ?? 0))[0];
  return <section className={`result-screen ${won ? "won" : ""}`}>
    <span className="eyebrow">{won ? "ABSOLUTELY COMMITTED TO THE BIT" : "A RESPECTABLE STRATEGIC PIVOT"}</span>
    <h1>{won ? "In character." : "Gave up. Fair enough."}</h1>
    <p className="result-intro">{won ? "Ten straight scores. Alarmingly convincing consultancy." : "Some characters are harder to live with than others."}</p>
    <div className="result-card arcade-panel">
      <CharacterArt character={character} />
      <div><span className="eyebrow">YOUR CHARACTER</span><h2>{character.name}</h2>
        <div className="result-stats"><span>{won ? <Trophy size={20} /> : <RotateCcw size={20} />}{won ? "10-score streak" : "No win this time"}</span><span>{formatElapsed(elapsed)} on stage</span><span>{Math.round((peaks[character.id] ?? 0) * 100)}% best match</span></div>
        {rival && <p className="rival-note">A brief detour into <strong>{rival.name}</strong>.<br /><small>{Math.round((peaks[rival.id] ?? 0) * 100)}% at your most suspicious moment.</small></p>}
      </div>
    </div>
    <div className="result-recap">
      <CharacterRace readings={readings} targetId={character.id} final />
      <TranscriptReview transcript={transcript} highlights={highlights} onRetry={onRetryHighlights} />
    </div>
    <button className="arcade-button primary" onClick={onAgain}>Draw again <ArrowRight size={22} /></button>
    <p className="result-footnote">New character. Same questionable instincts.</p>
  </section>;
}
