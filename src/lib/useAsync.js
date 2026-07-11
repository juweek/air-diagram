import { useState, useEffect, useRef } from 'react';

/**
 * The entire async story for lookup pages. Runs fn(key) whenever key changes;
 * caches results per key in memory so re-entering the same zip doesn't refetch.
 * Deliberately tiny and dependency-free — read it, it's the whole thing.
 *
 * Returns { status: 'idle' | 'loading' | 'done' | 'error', data?, error? }.
 * Pages render off status; see src/pages/AirPage.jsx for the pattern.
 *
 * NOTE: pass a stable fn (a module-level import like `getByQuery`, not an inline
 * arrow) or the effect will re-run every render.
 */
export function useAsync(fn, key) {
  const [state, setState] = useState({ status: 'idle' });
  const cache = useRef(new Map());
  useEffect(() => {
    if (!key) {
      setState({ status: 'idle' });
      return;
    }
    if (cache.current.has(key)) {
      setState({ status: 'done', data: cache.current.get(key) });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    fn(key)
      .then((data) => {
        if (!live) return;
        cache.current.set(key, data);
        setState({ status: 'done', data });
      })
      .catch((err) => {
        if (live) setState({ status: 'error', error: err.message });
      });
    return () => {
      live = false;
    };
  }, [fn, key]);
  return state;
}
