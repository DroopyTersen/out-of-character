import { Link } from "react-router";
import type { ReactNode } from "react";

export function GameHeader({ children, workshop = false }: { children?: ReactNode; workshop?: boolean }) {
  return <header className="game-header"><Link className="brand" to="/" aria-label="Out of Character home"><img className="pixel-logo" src="/logo-consultant-masks.png" alt="" /><span>Out of Character</span></Link><span className="edition">CONSULTANCY EDITION</span><nav>{children}{!workshop && <Link className="workshop-link" to="/storybook">Workshop <span>↗</span></Link>}{workshop && <Link className="workshop-link" to="/">Play the game <span>↗</span></Link>}</nav></header>;
}
