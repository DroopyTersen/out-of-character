import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Mic, Target, Presentation, FileText } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Catalog, ClientStats } from '../../core/simulator/types';

const traits: [keyof ClientStats, string][] = [['assertiveness', 'Assertiveness'], ['skepticism', 'Skepticism'], ['guardedness', 'Guardedness'], ['bargaining', 'Bargaining'], ['riskAversion', 'Risk aversion'], ['relationship', 'Relationship focus']];

export function SimulatorSelection({ catalog, scenarioId, clientId, onScenario, onClient, onStart, enabled = true, error }: {
  catalog: Catalog; scenarioId: string; clientId: string;
  onScenario: (id: string) => void; onClient: (id: string) => void; onStart: () => void;
  enabled?: boolean; error?: string | null;
}) {
  const scenario = catalog.scenarios.find(item => item.id === scenarioId)!;
  const client = catalog.clients.find(item => item.id === clientId)!;
  const rail = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [canScroll, setCanScroll] = useState({ previous: false, next: false });
  const updateScroll = () => {
    const node = rail.current;
    if (node) setCanScroll({ previous: node.scrollLeft > 1, next: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 });
  };
  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(node);
    updateScroll();
    return () => observer.disconnect();
  }, [catalog.clients.length]);
  const scroll = (direction: number) => rail.current?.scrollBy({ left: direction * ((rail.current?.querySelector('button')?.getBoundingClientRect().width ?? 180) + 12), behavior: reduced ? 'instant' : 'smooth' });
  return <section className="sim-selection">
    <header className="sim-heading"><h1>Choose your simulation</h1><p>A real conversation. A safe place to practice.</p></header>
    <div className="sim-selection-grid">
      <section className="sim-panel"><header className="sim-section-heading"><h2>The scenario</h2><span>{catalog.scenarios.length} scenarios{catalog.scenarios.length > 3 && <small>Scroll ↓</small>}</span></header>
        <div className="sim-scenario-list" role="group" aria-label="Choose a scenario">
          {catalog.scenarios.map(item => <button className={`sim-scenario ${item.id === scenarioId ? 'selected' : ''}`} key={item.id} aria-pressed={item.id === scenarioId} onClick={() => onScenario(item.id)}><span className="sim-scenario-icon" aria-hidden="true">{item.category === 'Sales' ? <Presentation /> : <FileText />}</span><span className="sim-scenario-copy"><small>{item.category}</small><strong>{item.title}</strong></span><span className="sim-choice-mark">{item.id === scenarioId && <Check size={17} />}</span></button>)}
        </div>
        <AnimatePresence mode="wait" initial={false}><motion.div key={scenario.id} className="sim-brief" initial={{ opacity: 0, y: reduced ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .15 }}>
          <span className="eyebrow">YOUR LEAD · {scenario.role.toUpperCase()}</span><p>{scenario.lead}</p><div className="sim-meta"><Target size={15} />{scenario.objectives.length} objectives · {scenario.durationMinutes} minutes · Live coaching</div>
          <details className="sim-company"><summary>Your consultancy</summary><p>You help clients improve how their people and software work together.</p><ul>{scenario.services.map(service => <li key={service}>{service}</li>)}</ul></details>
        </motion.div></AnimatePresence>
      </section>
      <section className="sim-panel"><header className="sim-section-heading"><h2>Your client</h2><div className="sim-rail-controls"><span>{catalog.clients.length} clients</span><button className="quiet-button" aria-label="Previous clients" disabled={!canScroll.previous} onClick={() => scroll(-1)}><ArrowLeft size={16} /></button><button className="quiet-button" aria-label="Next clients" disabled={!canScroll.next} onClick={() => scroll(1)}><ArrowRight size={16} /></button></div></header>
        <div className="sim-client-rail" ref={rail} onScroll={updateScroll} role="group" aria-label="Choose a client">{catalog.clients.map(item => <button className={`sim-client-card ${item.id === clientId ? 'selected' : ''}`} aria-pressed={item.id === clientId} key={item.id} onClick={() => onClient(item.id)}><span className="sim-choice-mark">{item.id === clientId && <Check size={17} />}</span><img src={item.image} alt="" draggable={false} /><strong>{item.name}</strong><span>{item.style.split(' & ')[0]}</span></button>)}</div>
        <AnimatePresence mode="wait" initial={false}><motion.div className="sim-client-brief" key={client.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .15 }}><img className="sim-selected-portrait" src={client.image} alt="" /><div><h3>{client.name}</h3><span>{scenario.clientRole} · {client.style}</span><p>{client.description}</p></div><details className="sim-traits"><summary>Behavior profile</summary><div>{traits.map(([id, label]) => <div key={id}><span>{label}</span><meter min={0} max={4} value={client.stats[id]} aria-label={label} /><small>{client.stats[id]}/4</small></div>)}</div></details></motion.div></AnimatePresence>
        <p className="sim-panel-foot">Same scenario. Different conversation.</p>
      </section>
    </div>
    <div className="sim-start">{error && <p role="alert" className="sim-notice error">{error}</p>}{!enabled && <p className="sim-notice">Live practice is currently unavailable. Explore the <a href="/storybook/simulator-live">workshop previews</a>.</p>}<button className="arcade-button primary" disabled={!enabled} onClick={onStart}>Start simulation <Mic size={22} /></button><small>Speak naturally. The client has their own priorities.</small></div>
  </section>;
}
