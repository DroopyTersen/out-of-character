import { motion, useReducedMotion } from "motion/react";

const point = (value: number, radius: number) => ({ x: 240 - Math.cos(value * Math.PI) * radius, y: 190 - Math.sin(value * Math.PI) * radius });

export function TargetGauge({ value, progress, stale = false }: { value: number | null; progress: number; stale?: boolean }) {
  const reducedMotion = useReducedMotion();
  const current = value;
  const needle = point(current ?? 0, 162);
  return <div className={`target-gauge ${stale ? "is-stale" : ""}`}>
    <svg viewBox="0 -32 480 247" role="img" aria-label={current === null ? "Waiting for a character match" : `${Math.round(current * 100)} percent character match`}>
      {Array.from({ length: 20 }, (_, index) => { const a = point(index / 20 + 0.003, 174), b = point((index + 1) / 20 - 0.003, 174); return <path key={index} d={`M ${a.x} ${a.y} A 174 174 0 0 1 ${b.x} ${b.y}`} stroke={index >= 16 ? "#44efcd" : "#284d68"} strokeWidth="19" fill="none" />; })}
      {[0, 25, 50, 75, 100].map(tick => { const p = point(tick / 100, 207); return <text key={tick} x={p.x} y={p.y + 6} textAnchor="middle" className="gauge-tick">{tick}</text>; })}
      <motion.line x1="240" y1="190" animate={{ x2: needle.x, y2: needle.y }} transition={{ duration: reducedMotion ? 0 : 0.25 }} stroke="#eaf4fc" strokeWidth="5" />
      <circle cx="240" cy="190" r="8" fill="#eaf4fc" />
      <rect x="154" y="132" width="172" height="60" fill="#071e2c" />
      <text x="240" y="180" textAnchor="middle" className="gauge-number" fill={current !== null && current >= 0.8 ? "#44efcd" : "#eaf4fc"}>{current === null ? "—" : Math.round(current * 100)}<tspan className="gauge-percent">{current === null ? "" : "%"}</tspan></text>
      <text x="430" y="92" textAnchor="middle" className="gauge-zone">WIN</text><text x="430" y="108" textAnchor="middle" className="gauge-zone">ZONE</text>
    </svg>
    <div className="hold-row"><span>WIN STREAK</span><div className="hold-blocks" role="progressbar" aria-label="Consecutive scores in the win zone" aria-valuemin={0} aria-valuemax={10} aria-valuenow={Math.min(10, Number(progress.toFixed(1)))}>{Array.from({ length: 10 }, (_, index) => <i key={index} className={progress >= index + 1 ? "filled" : progress > index ? "current" : ""} />)}</div><strong>{Math.floor(progress)} / 10</strong></div>
    <p className="gauge-instruction">{stale ? "Last reading · Your streak is saved. Continue when you’re ready." : "Get 10 consecutive scores at 80% or above to win."}</p>
  </div>;
}
