import { NavLink } from 'react-router-dom';
import site from '../site.config';

// Header + nav + footer. Cream canvas, rose brand mark, attribution pinned to
// every page (required).
export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="border-b border-grid-strong/60">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <div className="flex items-baseline gap-3">
            <span className="inline-block h-1.5 w-11 bg-rose" aria-hidden />
            <h1 className="font-title text-2xl">{site.title}</h1>
          </div>
          <p className="mt-2 font-subtitle text-ink-muted">{site.tagline}</p>

          <nav className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {site.nav.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `border-b-2 pb-0.5 transition-colors ${
                    isActive
                      ? 'border-data-primary text-data-primary'
                      : 'border-transparent text-ink hover:text-data-primary'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>

      <footer className="mt-12 border-t border-grid-strong/60">
        <div className="mx-auto max-w-5xl px-5 py-6 text-xs text-ink-muted">
          <p>
            Data from{' '}
            <a
              className="text-data-primary underline"
              href={site.attribution.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {site.attribution.sourceName}
            </a>{' '}
            — {site.attribution.sourceOrg}.
          </p>
          <p className="mt-1">{site.attribution.note}</p>
        </div>
      </footer>
    </div>
  );
}
