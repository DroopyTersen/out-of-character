import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, LoaderCircle, MessageSquare, RotateCw } from "lucide-react";
import type { Character } from "../../core/characters";
import { CharacterReel, Lever } from "./character-reel";

export type DrawScreenProps = {
  character: Character | null; spinning: boolean; spinNumber: number; onLand: () => void; onSpin: () => void;
  scene: { status: "empty" | "loading" | "ready" | "error"; text: string; error?: string };
  onNewScene: () => void; onStart: () => void; connecting?: boolean;
};

export function DrawScreen({ character, spinning, spinNumber, onLand, onSpin, scene, onNewScene, onStart, connecting = false }: DrawScreenProps) {
  const revealed = character && !spinning;
  return <>
    <div className="draw-heading"><h1>Choose your character</h1></div>
    <div className="draw-panels">
      <section className="arcade-panel character-draw" aria-label="Character selection">
        <CharacterReel character={character} spinning={spinning} spinNumber={spinNumber} onLand={onLand} />
        <div className={`draw-details ${revealed ? "revealed" : ""}`}>
          <AnimatePresence mode="wait" initial={false}>
            {revealed ? <motion.div key={character.id} className="character-copy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span className="eyebrow">YOUR ALTER EGO</span><h2>{character.name.replace(/^The /, "")}</h2><p>{character.backstory.replace(/[*`]/g, "")}</p>
            </motion.div> : <motion.div key="lever" className="lever-area" exit={{ opacity: 0 }}><Lever onSpin={onSpin} disabled={spinning} /><p className="lever-hint">42 questionable consultants.<br />One very convincing you.</p></motion.div>}
          </AnimatePresence>
          {revealed && <button className="quiet-button" onClick={onSpin} disabled={spinning || connecting} aria-label="Re-spin for a new character"><RotateCw size={15} /> Re-spin</button>}
        </div>
      </section>
      <section className="arcade-panel scene-panel" aria-label="Your scene">
        <header><h2><MessageSquare size={23} /> Your scene</h2><button className="quiet-button" onClick={onNewScene} disabled={!revealed || scene.status === "loading" || connecting} aria-label="Generate a new scene"><RotateCw size={15} /><span>New scene</span></button></header>
        <div className="scene-copy" aria-live="polite">
          {(!character || spinning) && scene.status !== "loading" ? <div className="scene-placeholder"><MessageSquare size={46} strokeWidth={1} /><p>Your scene appears after the spin.</p><small>No script. Just a situation and a little nerve.</small></div>
          : !revealed || scene.status === "loading" ? <div className="scene-placeholder"><LoaderCircle className="spin-icon" size={30} /><p>Setting the scene…</p><small>Your moment is coming.</small></div>
          : scene.status === "error" ? <div className="scene-placeholder"><p>{scene.error || "We couldn’t set the scene."}</p><button className="outline-button" onClick={onNewScene}>Retry scene</button></div>
          : <motion.p key={scene.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{scene.text}</motion.p>}
        </div>
        <div className="scene-footnote"><span>✦</span> Answer as your character. There’s no right script.</div>
      </section>
    </div>
    <footer className="draw-footer"><button className="arcade-button primary" disabled={Boolean(character && (spinning || scene.status !== "ready" || connecting))} onClick={character ? onStart : onSpin}>
      {connecting ? <><LoaderCircle className="spin-icon" size={19} /> Connecting audio…</> : spinning ? "Spinning…" : character ? <>Start your turn <ArrowRight size={23} /></> : <>Spin for a character <ArrowRight size={23} /></>}
    </button>{character && !spinning && <p className="turn-instruction">Speak in character. Hold 80% match (AI decides) for 10 seconds.</p>}</footer>
  </>;
}
