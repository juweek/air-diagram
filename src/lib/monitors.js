// Nearest regulatory PM2.5 monitor — the compiled counter-dataset.
//
// The AQI in your app is usually a model, not a reading from your block. This
// answers the question the official number never does: where IS the nearest
// regulatory-grade PM2.5 monitor, and how far is your air being interpolated
// from? Sites are compiled from EPA's AQS monitor listing (parameter 88101,
// PM2.5 FRM/FEM), filtered to sites that reported a sample since mid-2024 —
// 1,053 active sites covering 648 of ~3,144 US counties (≈1 in 5).
//
// Data: src/data/pm25Monitors.json — [lat, lon, siteName, county, state] rows,
// compiled from https://aqs.epa.gov/aqsweb/airdata/aqs_monitors.zip
// (EPA extraction date 2025-11-25). Refresh ~yearly by re-running the compile.

const EARTH_RADIUS_MI = 3958.8;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

// The 57KB site list only loads when a real place is looked up (scenarios and
// the baseline never need it), so it stays out of the initial bundle.
let sitesPromise = null;
function loadSites() {
  if (!sitesPromise) {
    sitesPromise = import('../data/pm25Monitors.json').then((m) => m.default);
  }
  return sitesPromise;
}

// → { name, county, state, distanceMi } for the closest active site, or null
// if the list can't load (the readout just omits the line — never blocks air data).
export async function nearestMonitor(latitude, longitude) {
  try {
    const sites = await loadSites();
    let best = null;
    let bestDist = Infinity;
    for (const [lat, lon, name, county, state] of sites) {
      const d = haversineMiles(latitude, longitude, lat, lon);
      if (d < bestDist) {
        bestDist = d;
        best = { name, county, state };
      }
    }
    return best ? { ...best, distanceMi: Math.round(bestDist) } : null;
  } catch {
    return null;
  }
}
