import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { characters, type Character } from "../../core/characters";
import { CharacterArt } from "./character-art";

export function CharacterReel({ character, spinning, spinNumber, onLand }: { character: Character | null; spinning: boolean; spinNumber: number; onLand: () => void }) {
  const reducedMotion = useReducedMotion();
  const [artReady, setArtReady] = useState(false);
  useEffect(() => {
    if (reducedMotion) { setArtReady(true); return; }
    let mounted = true;
    Promise.all(characters.map(item => {
      const image = new Image();
      image.src = item.image;
      return image.decode().catch(() => {});
    })).then(() => { if (mounted) setArtReady(true); });
    return () => { mounted = false; };
  }, [reducedMotion]);
  const strip = useMemo(() => {
    const catalogue = characters.map((_, index) => characters[(index + spinNumber * 13) % characters.length]!);
    // Reverse the physical strip so each next symbol arrives from above.
    return [catalogue[0]!, ...catalogue, ...catalogue.slice(0, 8), character ?? catalogue[0]!, catalogue[1]!].reverse();
  }, [character, spinNumber]);
  const start = -(strip.length - 1) * 150;
  const coast = start + (characters.length - 1) * 150;
  const landedSpin = useRef<number | null>(null);
  useEffect(() => { if (!character) landedSpin.current = null; }, [character]);
  return <div className="reel" aria-label={spinning ? "Drawing a character" : character ? `Selected: ${character.name}` : "Character reel"}>
    <div className="reel-track">
      {character ? <motion.div key={spinNumber} className="reel-strip" initial={{ y: reducedMotion ? -150 : start }} animate={{ y: reducedMotion ? -150 : artReady ? [start, start + 450, coast, -138, -154, -150] : start }} transition={reducedMotion ? { duration: 0.08 } : { duration: 6.2, times: [0, 0.14, 0.69, 0.955, 0.98, 1], ease: [[0.7, 0, 1, 1], "linear", [0.2, 0.38, 0.5, 1], "easeOut", "easeOut"] }} onAnimationComplete={() => {
        if (!artReady || !spinning || landedSpin.current === spinNumber) return;
        landedSpin.current = spinNumber;
        onLand();
      }}>
        {strip.map((item, index) => <div className="reel-tile" data-character-id={item.id} data-landing={index === 1 || undefined} key={`${index}-${item.id}`}><CharacterArt character={item} decorative /></div>)}
      </motion.div> : <div className="reel-idle"><CharacterArt character={characters[4]!} decorative /><div className="mystery-tile">?</div><CharacterArt character={characters[0]!} decorative /></div>}
    </div>
    <div className="reel-shade top" /><div className="reel-shade bottom" />
    <div className="reel-window" /><span className="reel-pointer top">◆</span><span className="reel-pointer bottom">◆</span>
  </div>;
}

export function Lever({ onSpin, disabled }: { onSpin: () => void; disabled: boolean }) {
  const reducedMotion = useReducedMotion();
  const [pulled, setPulled] = useState(false);
  const active = useRef(false);
  const held = useRef(false);
  const engaged = useRef(false);
  const touch = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const begin = (isTouch = false) => {
    if (disabled || active.current) return;
    active.current = true; held.current = true; engaged.current = false; touch.current = isTouch;
    setPulled(true);
  };
  const release = () => {
    held.current = false;
    if (engaged.current) { active.current = false; setPulled(false); }
  };
  const cancel = () => {
    held.current = false; active.current = false;
    setPulled(false);
  };
  useEffect(() => {
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      if (returnTimer.current) clearTimeout(returnTimer.current);
    };
  }, []);
  return <button className="lever" data-pulled={pulled || undefined} disabled={disabled && !pulled} aria-disabled={disabled} aria-label="Pull the lever to draw a character"
    onPointerDown={event => { if (event.button === 0) begin(event.pointerType === "touch"); }}
    onPointerUp={release} onPointerCancel={cancel} onPointerLeave={() => { if (!touch.current) cancel(); }}
    onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) begin(); } }}
    onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); release(); } }}
    onBlur={cancel} onClick={event => { if (event.detail === 0) { begin(true); held.current = false; } }}>
    <span className="lever-mechanism"><span className="lever-base" /><motion.span className="lever-arm" initial={false} animate={{ rotate: pulled ? 55 : 12 }} transition={{ duration: reducedMotion ? 0.04 : pulled ? 0.2 : 0.3, ease: pulled ? [0.45, 0, 0.7, 1] : [0.2, 0.8, 0.3, 1] }} onAnimationComplete={() => {
      if (!pulled || engaged.current) return;
      engaged.current = true;
      onSpin();
      if (touch.current) returnTimer.current = setTimeout(release, 80);
      else if (!held.current) release();
    }}><span className="lever-shaft" /><span className="lever-ball" /></motion.span></span><span className="lever-label">PULL TO SPIN <span>↓</span></span>
  </button>;
}
