import { Link } from "react-router";
import type { ReactNode } from "react";

export function GameHeader({ children, workshop = false, simulator = false }: { children?: ReactNode; workshop?: boolean; simulator?: boolean }) {
  return <header className={`game-header ${simulator ? 'simulator-header' : ''}`}><Link className="brand" to="/" aria-label="Out of Character home"><img className="pixel-logo" src="/logo-consultant-masks.png" alt="" /><span>Out of Character</span></Link>{!simulator && <span className="edition">CONSULTANCY EDITION</span>}<nav>{children}<Link className="workshop-link" to={simulator ? '/' : '/simulator'}>{simulator ? 'Game' : 'Simulator'}</Link>{!workshop && <Link className="workshop-link" to="/storybook">Workshop <span>↗</span></Link>}{workshop && !simulator && <Link className="workshop-link" to="/">Play the game <span>↗</span></Link>}{simulator && <span className="simulator-title">The Simulator</span>}</nav></header>;
}
