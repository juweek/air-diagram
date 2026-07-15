import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import site from '../site.config';

// Masthead + nav + footer, Style-2 dark editorial. Tracked-uppercase nav links,
// a serif wordmark, and a pill-outline CTA back to the search. Attribution stays
// pinned to every page (required). The dusk gradient behind everything lives in
// index.css (body::before), so the chrome here is transparent over it.
// On phones the inline nav collapses into a menu so "The monitor gap" stays
// reachable — it's a core piece of the argument, not a desktop-only extra.
export default function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
          <div className="flex items-center gap-2">
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Open menu"
                onClick={() => setMenuOpen((o) => !o)}
                className="label-caps rounded-full border border-grid-strong px-3 py-2 !text-ink transition-colors hover:!border-ink"
              >
                Menu {menuOpen ? '▴' : '▾'}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-2 min-w-[11rem] rounded-lg border border-grid-strong bg-cream py-1 shadow-xl"
                >
                  {site.nav.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `block px-4 py-2.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-ink/10 font-semibold text-ink-bright'
                            : 'text-ink hover:bg-ink/5'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
            <a
              href={site.support.url}
              target="_blank"
              rel="noreferrer"
              className="label-caps rounded-full border border-grid-strong px-3 py-2 !text-ink transition-colors hover:!border-ink sm:px-4"
            >
              <span className="sm:hidden">Support</span>
              <span className="hidden sm:inline">{site.support.label}</span>
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 lg:px-10">{children}</main>

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
