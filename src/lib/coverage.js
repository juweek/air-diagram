// Coverage-gap grid — a client-side choropleth of "how far is the nearest
// monitor?" built entirely from the static monitor list (NO data pull). Each
// land cell is colored by distance to its nearest regulatory PM2.5 monitor;
// cells beyond the last band are omitted, so the map's holes ARE the gaps.
//
// Computed lazily (only when the coverage layer is first shown) and memoized by
// the caller. ~6k cells × ~1k monitors with a cheap equirectangular distance is
// well under a frame's budget.

import monitors from '../data/pm25Monitors.json';
import usStates from '../data/usStates.json';

// Distance bands in miles → fill color. Beyond the last band = uncovered (gap),
// no cell emitted.
export const COVERAGE_BANDS = [
  { max: 30, color: '#3B9C46', label: '≤ 30 mi — well covered' },
  { max: 75, color: '#C7A70A', label: '30–75 mi — marginal' },
  { max: 150, color: '#E07C00', label: '75–150 mi — poor' },
];
const MAX_MI = COVERAGE_BANDS[COVERAGE_BANDS.length - 1].max;

// ── point-in-polygon (ray casting), with per-feature bbox prefilter ──────────
function ringContains(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polygonContains(x, y, rings) {
  if (!ringContains(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (ringContains(x, y, rings[i])) return false; // hole
  return true;
}

// Precompute each state's polygons + bbox once.
const LAND = usStates.features.flatMap((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.map((rings) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of rings[0]) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return { rings, minX, minY, maxX, maxY };
  });
});
function onLand(x, y) {
  for (const poly of LAND) {
    if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) continue;
    if (polygonContains(x, y, poly.rings)) return true;
  }
  return false;
}

// [lat, lon] for every monitor (rows are [lat, lon, name, county, state]).
const MON = monitors.map((m) => [m[0], m[1]]);

export function buildCoverageGrid(cell = 0.5) {
  const features = [];
  for (let lon = -125; lon < -66; lon += cell) {
    for (let lat = 24; lat < 50; lat += cell) {
      const cx = lon + cell / 2;
      const cy = lat + cell / 2;
      if (!onLand(cx, cy)) continue;
      // Nearest-monitor distance via equirectangular approximation (fast, plenty
      // accurate for banding at this scale).
      const mpdLon = 69 * Math.cos((cy * Math.PI) / 180);
      let best = Infinity;
      for (const [mlat, mlon] of MON) {
        const dLat = (cy - mlat) * 69;
        const dLon = (cx - mlon) * mpdLon;
        const d2 = dLat * dLat + dLon * dLon;
        if (d2 < best) best = d2;
      }
      const dist = Math.sqrt(best);
      if (dist > MAX_MI) continue; // gap → no cell, hole shows through
      const band = COVERAGE_BANDS.find((b) => dist <= b.max);
      features.push({
        type: 'Feature',
        properties: { color: band.color },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lon, lat],
              [lon + cell, lat],
              [lon + cell, lat + cell],
              [lon, lat + cell],
              [lon, lat],
            ],
          ],
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
