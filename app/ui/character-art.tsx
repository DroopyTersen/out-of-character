import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import type { Character } from "../../core/characters";

export function CharacterArt({ character, className = "", decorative = false }: { character: Character; className?: string; decorative?: boolean }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => setMissing(false), [character.id]);
  if (missing) return <span className={`missing-art ${className}`} aria-label={decorative ? undefined : character.name}><UserRound /><small>Art incoming</small></span>;
  return <img className={`character-art ${className}`} src={character.image} alt={decorative ? "" : character.name} onError={() => setMissing(true)} draggable={false} />;
}
