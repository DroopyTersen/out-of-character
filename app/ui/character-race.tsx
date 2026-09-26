import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { characters } from "../../core/characters";
import { CharacterArt } from "./character-art";

export function CharacterRace({ readings, targetId, live = false, final = false }: { readings: Record<string, number>; targetId: string; live?: boolean; final?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const ranked = characters.map(character => ({ character, value: readings[character.id] ?? 0 })).sort((a, b) => b.value - a.value || a.character.id.localeCompare(b.character.id)).map((item, index) => ({ ...item, rank: index + 1 }));
  const leaders = ranked.filter(item => item.value >= 0.05).slice(0, 12);
  if (!leaders.some(item => item.character.id === targetId)) { if (leaders.length === 12) leaders.pop(); leaders.push(ranked.find(item => item.character.id === targetId)!); leaders.sort((a, b) => a.rank - b.rank); }
  const displayed = final ? Object.keys(readings).length ? ranked.slice(0, 10) : [] : expanded ? ranked : leaders;
  return <section className={`arcade-panel race-panel ${final ? 'final-race' : ''}`}><header><h2>{final ? 'Final top 10' : 'Who do you sound like?'}</h2><span className={`live-indicator ${live ? "active" : ""}`}><i />{final ? 'FINAL' : live ? "LIVE" : Object.keys(readings).length ? "LAST SCORE" : "READY"}</span></header>
    {final && <p className="recap-note">Where you finished. Your last scored moment, not each character’s peak.</p>}
    <div className="race-list">{displayed.map(({ character, value, rank }) => <motion.div layout={!reduced} transition={{ duration: 0.25 }} key={character.id} className={`race-row ${character.id === targetId ? "target" : rank === 1 && value >= 0.05 ? "leader" : ""}`}>
      <span className="rank">{Object.keys(readings).length ? rank : "–"}</span><CharacterArt character={character} decorative /><span className="race-name">{character.name.replace(/^The /, "")}{character.id === targetId && <small>TARGET</small>}</span>
      <div className="bar-track"><motion.div className="bar-fill" initial={false} animate={{ width: `${value * 100}%` }} transition={{ duration: reduced ? 0 : 0.2 }} /></div><strong>{Math.round(value * 100)}<small>%</small></strong>
    </motion.div>)}</div>
    {!Object.keys(readings).length && <div className="race-empty"><span className="signal-bars"><i /><i /><i /><i /><i /></span><h3>{final ? 'No scores this time.' : 'The room is listening.'}</h3><p>{final ? 'This turn ended before the first judgment.' : <>Your words will bring the cast to life.<br />Lean into the character’s bad habits.</>}</p></div>}
    {!final && <button className="race-expand" onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}<span>{expanded ? "Back to the leaders" : `Rest of the cast (${characters.length - displayed.length})`}</span><small>{ranked.filter(item => item.value < 0.05).length} below 5%</small></button>}
  </section>;
}
