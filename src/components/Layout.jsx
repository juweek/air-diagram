import { NavLink } from 'react-router-dom';
import site from '../site.config';

// Masthead + nav + footer, Style-2 dark editorial. Tracked-uppercase nav links,
// a serif wordmark, and a pill-outline CTA back to the search. Attribution stays
// pinned to every page (required). The dusk gradient behind everything lives in
// index.css (body::before), so the chrome here is transparent over it.
export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-grid-medium/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="font-display text-lg italic text-ink-bright">
              {site.title}
            </NavLink>
            <nav className="hidden gap-6 sm:flex">
              {site.nav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    `label-caps border-b pb-0.5 transition-colors ${
                      isActive
                        ? '!text-ink-bright border-current'
                        : 'border-transparent hover:!text-ink'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <NavLink
            to="/"
            className="label-caps rounded-full border border-grid-strong px-4 py-2 !text-ink transition-colors hover:!border-ink"
          >
            Get your reading
          </NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">{children}</main>

      <footer className="mt-12 border-t border-grid-medium/70">
        <div className="mx-auto max-w-7xl px-5 py-6 text-xs text-ink-muted">
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
