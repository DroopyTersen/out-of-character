import { useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import './navigation.css';

const destinations = [
  { to: '/', label: 'Game' },
  { to: '/simulator', label: 'Simulator' },
  { to: '/interview', label: 'The Debrief' },
  { to: '/storybook', label: 'Workshop' },
];

function NavigationLinks({ onChoose }: { onChoose?: () => void }) {
  return destinations.map(destination => <NavLink key={destination.to} to={destination.to} end={destination.to === '/'} onClick={onChoose} className={({ isActive }) => isActive ? 'site-nav-link active' : 'site-nav-link'}>{destination.label}</NavLink>);
}

export function GameHeader({ children, workshop = false, simulator = false, interview = false }: { children?: ReactNode; workshop?: boolean; simulator?: boolean; interview?: boolean }) {
  const { pathname } = useLocation();
  const menu = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = () => { menu.current?.showModal(); setMenuOpen(true); };
  const closeMenu = () => menu.current?.close();
  const onMenuClose = () => { setMenuOpen(false); trigger.current?.focus(); };
  // Voice Lab's existing back link has the same destination as the shared Simulator link.
  const showActions = !!children && pathname !== '/simulator/voice-lab';
  return <header className={`game-header site-header ${simulator ? 'simulator-header' : ''}`} data-workshop={workshop || undefined}>
    <Link className="brand" to="/" aria-label="Out of Character home"><img className="pixel-logo" src="/logo-consultant-masks.png" alt="" /><span>Out of Character</span></Link>
    {!simulator && <span className="edition">CONSULTANCY EDITION</span>}
    <nav className="site-desktop-nav" aria-label="Main navigation"><NavigationLinks /></nav>
    {showActions && <div className="site-header-actions">{children}</div>}
    {simulator && <span className="simulator-title site-page-title">{interview ? 'The Debrief' : 'The Simulator'}</span>}
    <button ref={trigger} className="site-menu-trigger" type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={openMenu}><Menu size={23} aria-hidden="true" /></button>
    <dialog ref={menu} className="site-menu-dialog" aria-label="Navigation" onClose={onMenuClose} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}>
      <div className="site-menu-heading"><span className="eyebrow">OUT OF CHARACTER</span><button type="button" aria-label="Close navigation" onClick={closeMenu}><X size={22} aria-hidden="true" /></button></div>
      <nav aria-label="Mobile navigation"><NavigationLinks onChoose={closeMenu} /></nav>
    </dialog>
  </header>;
}
