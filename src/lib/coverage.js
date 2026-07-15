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

// Distance bands in miles → fill color. Beyond the last band = uncovered (gap).
export const COVERAGE_BANDS = [
  { max: 30, color: '#3B9C46', label: '≤ 30 mi — well covered' },
  { max: 75, color: '#C7A70A', label: '30–75 mi — marginal' },
  { max: 150, color: '#E07C00', label: '75–150 mi — poor' },
];

// Beyond the last band the land used to be left BLANK (holes showing through the
// cream map). On the charcoal map a blank hole just reads as background, so we
// paint the gap a bold deep red instead — among the muted green/amber covered
// bands, the red uncovered land becomes the loudest thing on the map.
// (Emphasis lives in the COLOUR, not per-feature opacity: MapLibre's fill-opacity
// is not data-driven, so a single constant opacity applies to the whole layer.)
export const COVERAGE_GAP = { color: '#C42B1F', label: '> 150 mi — uncovered (gap)' };

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

// Is a lon/lat point inside a US state polygon? Reuses the same land polygons as
// the coverage grid. Used to drop AirNow monitors that sit just over the border
// (its BBOX pull includes some Canadian/Mexican sites) so the map is US-only.
export function pointInUS(lon, lat) {
  return onLand(lon, lat);
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
      const band = COVERAGE_BANDS.find((b) => dist <= b.max);
      // On-land cells always emit now — covered land takes its band colour, the
      // uncovered gap takes deep red. The holes become the point.
      const color = band ? band.color : COVERAGE_GAP.color;
      features.push({
        type: 'Feature',
        properties: { color },
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
