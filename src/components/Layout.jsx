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
      {/* Off-screen filter that gives the fixed nav its "liquid glass"
         refraction: feTurbulence → feDisplacementMap warps whatever scrolls
         behind the pill (referenced from backdrop-filter in index.css). */}
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden focusable="false">
        <filter id="liquid-glass-distortion" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.014 0.02"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="1.4" result="blurredNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale="26"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>

      {/* Desktop: the two nav items float in a centered, fixed liquid-glass pill
         that stays pinned as the page scrolls underneath it. */}
      <nav className="liquid-glass fixed left-1/2 top-4 z-50 hidden -translate-x-1/2 items-center gap-1 rounded-full px-1 py-1 sm:flex">
        {site.nav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `label-caps rounded-full px-4 py-1.5 !text-[11px] !font-bold transition-colors ${
                isActive
                  ? '!bg-ink !text-cream'
                  : '!text-ink hover:!bg-ink/10 hover:!text-ink-bright'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Desktop: the support CTA is its own fixed liquid-glass pill, pinned
         top-right, matching the nav. (Mobile keeps its in-header button.) */}
      <a
        href={site.support.url}
        target="_blank"
        rel="noreferrer"
        className="liquid-glass label-caps fixed right-6 top-4 z-50 hidden items-center rounded-full px-5 py-2.5 !text-[11px] !font-bold !text-ink transition-colors hover:!text-ink-bright sm:flex"
      >
        {site.support.label}
      </a>

      <header className="border-b border-grid-medium/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="font-display text-lg italic text-ink-bright">
              {site.title}
            </NavLink>
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
              className="label-caps rounded-full border border-grid-strong px-3 py-2 !text-ink transition-colors hover:!border-ink sm:hidden"
            >
              Support
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
