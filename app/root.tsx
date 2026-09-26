import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export const links = () => [
  { rel: "icon", type: "image/png", href: "/logo-consultant-masks.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Silkscreen&display=swap" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="theme-color" content="#061a27" /><Meta /><Links /></head><body>{children}<ScrollRestoration /><Scripts /></body></html>;
}
export default function App() { return <Outlet />; }
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <main className="error-page"><h1>{isRouteErrorResponse(error) && error.status === 404 ? "Off script." : "A little out of character."}</h1><p>That page couldn’t load. Try a fresh start.</p><a className="arcade-button" href="/">Back to the game</a></main>;
}
