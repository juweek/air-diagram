// Static air-data fallback — "typical air near X" when the live API is down.
//
// The live path (Open-Meteo CAMS model) is a single point of failure: one outage
// and every lookup dies. This gives a graceful, HONEST stand-in — the nearest
// site's real 2024 EPA annual-average PM2.5 — clearly labeled as a typical
// annual figure, not today's air. It only ever loads if the live fetch fails.
//
// Data: src/data/pm25Typical.json — [lat, lon, annualMeanPM25] rows compiled
// from EPA's annual_conc_by_monitor (param 88101). See scripts/buildTypical.mjs.

import { haversineMiles } from './monitors.js';

let sitesPromise = null;
function loadSites() {
  if (!sitesPromise) {
    sitesPromise = import('../data/pm25Typical.json').then((m) => m.default);
  }
  return sitesPromise;
}

// → { pm2_5, distanceMi } for the nearest site's typical annual PM2.5, or null
// if the table can't load (the caller then surfaces the real live-fetch error).
export async function nearestTypical(latitude, longitude) {
  try {
    const sites = await loadSites();
    let best = null;
    let bestDist = Infinity;
    for (const [lat, lon, pm] of sites) {
      const d = haversineMiles(latitude, longitude, lat, lon);
      if (d < bestDist) {
        bestDist = d;
        best = pm;
      }
    }
    return best == null ? null : { pm2_5: best, distanceMi: Math.round(bestDist) };
  } catch {
    return null;
  }
}
