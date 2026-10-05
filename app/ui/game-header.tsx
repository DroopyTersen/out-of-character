import { useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Menu, X } from 'lucide-react';
import './navigation.css';

const destinations = [
  { to: '/', label: 'Game' },
  { to: '/simulator', label: 'Simulator' },
  { to: '/interview', label: 'The Debrief' },
  { to: '/conversation-map.html', label: 'Conversation Map', utility: true, page: true },
  { to: '/storybook', label: 'Debugger', utility: true },
];

// A static page from public/ sits outside the router, so it loads as a full document
function NavigationLinks({ onChoose }: { onChoose?: () => void }) {
  return destinations.map(destination => <NavLink key={destination.to} to={destination.to} end={destination.to === '/'} reloadDocument={destination.page} onClick={onChoose} className={({ isActive }) => `site-nav-link${destination.utility ? ' site-nav-utility' : ''}${isActive ? ' active' : ''}`}>{destination.label}</NavLink>);
}

export function GameHeader({ children, simulator = false, interview = false }: { children?: ReactNode; simulator?: boolean; interview?: boolean }) {
  const menu = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = () => { menu.current?.showModal(); setMenuOpen(true); };
  const closeMenu = () => menu.current?.close();
  const onMenuClose = () => { setMenuOpen(false); trigger.current?.focus(); };
  return <header className={`game-header site-header ${simulator ? 'simulator-header' : ''}`}>
    <Link className="brand" to="/" aria-label="Out of Character home"><img className="pixel-logo" src="/logo-consultant-masks.png" alt="" /><span>Out of Character</span></Link>
    {!simulator && <span className="edition">CONSULTANCY EDITION</span>}
    <nav className="site-desktop-nav" aria-label="Main navigation"><NavigationLinks /></nav>
    {children && <div className="site-header-actions">{children}</div>}
    {simulator && <span className="simulator-title site-page-title">{interview ? 'The Debrief' : 'The Simulator'}</span>}
    <button ref={trigger} className="site-menu-trigger" type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={openMenu}><Menu size={23} aria-hidden="true" /></button>
    <dialog ref={menu} className="site-menu-dialog" aria-label="Navigation" onClose={onMenuClose} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }}>
      <div className="site-menu-heading"><button type="button" aria-label="Close navigation" onClick={closeMenu}><X size={22} aria-hidden="true" /></button></div>
      <nav aria-label="Mobile navigation"><NavigationLinks onChoose={closeMenu} /></nav>
    </dialog>
  </header>;
}
