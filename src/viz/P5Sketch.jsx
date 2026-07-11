import { useRef, useEffect } from 'react';

/**
 * Wraps a p5 sketch so React owns the DOM node and p5 owns what's inside it.
 * Two jobs:
 *   1. Teardown — instance.remove() on unmount/prop change, or every prop
 *      change leaks a running draw loop.
 *   2. Code-splitting — p5 is big (~1 MB), so it's dynamic-imported here.
 *      Only pages that actually render a sketch download it; a chart-only
 *      tool stays light for embedding.
 *
 * `sketch` is a plain function (p, data) => { p.setup = …; p.draw = …; } —
 * always instance mode, never global mode (global mode breaks with multiple
 * embeds and with React remounts). See airParticleSketch.js for an example.
 */
export default function P5Sketch({ sketch, data }) {
  const ref = useRef(null);
  useEffect(() => {
    let instance;
    let live = true;
    import('p5').then(({ default: p5 }) => {
      if (!live) return;
      instance = new p5((p) => sketch(p, data), ref.current);
    });
    return () => {
      live = false;
      instance?.remove();
    };
  }, [sketch, data]);
  return <div ref={ref} />;
}
