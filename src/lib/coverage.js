// Coverage-gap layers — client-side choropleths of "how far is the nearest
// monitor?" built entirely from the static monitor list (NO data pull).
//
//   • buildCoverageGrid()  — 0.5° land cells (continuous distance surface)
//   • buildCountyCoverage()— US counties, same distance bands at the centroid
//
// Both reuse COVERAGE_BANDS / COVERAGE_GAP. Computed lazily (only when that
// mode is first shown) and memoized by the caller.

import monitors from '../data/pm25Monitors.json';
import usStates from '../data/usStates.json';
// usCounties.json (~1.3 MB) is loaded only when buildCountyCoverage() runs.

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

function nearestMiles(lat, lon) {
  const mpdLon = 69 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const [mlat, mlon] of MON) {
    const dLat = (lat - mlat) * 69;
    const dLon = (lon - mlon) * mpdLon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function colorForMiles(dist) {
  const band = COVERAGE_BANDS.find((b) => dist <= b.max);
  return band ? band.color : COVERAGE_GAP.color;
}

export function buildCoverageGrid(cell = 0.5) {
  const features = [];
  for (let lon = -125; lon < -66; lon += cell) {
    for (let lat = 24; lat < 50; lat += cell) {
      const cx = lon + cell / 2;
      const cy = lat + cell / 2;
      if (!onLand(cx, cy)) continue;
      // Nearest-monitor distance via equirectangular approximation (fast, plenty
      // accurate for banding at this scale).
      const dist = nearestMiles(cy, cx);
      // On-land cells always emit now — covered land takes its band colour, the
      // uncovered gap takes deep red. The holes become the point.
      features.push({
        type: 'Feature',
        properties: { color: colorForMiles(dist) },
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

// Average of an exterior ring's vertices — good enough as a county "center"
// for distance banding (not a true geographic centroid, and we say so in the UI).
function ringCenter(ring) {
  let sx = 0;
  let sy = 0;
  // Skip the closing duplicate vertex if present.
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  if (n <= 0) return null;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

function featureCenter(geometry) {
  if (geometry.type === 'Polygon') return ringCenter(geometry.coordinates[0]);
  // MultiPolygon: use the largest exterior ring (by vertex count — cheap proxy).
  let best = null;
  let bestN = -1;
  for (const poly of geometry.coordinates) {
    const ring = poly[0];
    if (ring.length > bestN) {
      bestN = ring.length;
      best = ring;
    }
  }
  return best ? ringCenter(best) : null;
}

// County choropleth of the same distance story: each county is colored by how
// far its approximate center sits from the nearest regulatory PM2.5 monitor.
// Same bands as the grid. Hover properties carry name/state/miles for the popup.
// Async so the ~1.3 MB county GeoJSON stays out of the map bundle until needed.
export async function buildCountyCoverage() {
  const { default: usCounties } = await import('../data/usCounties.json');
  const features = [];
  for (const f of usCounties.features) {
    const center = featureCenter(f.geometry);
    if (!center) continue;
    const [lon, lat] = center;
    const dist = nearestMiles(lat, lon);
    const miles = Math.round(dist);
    features.push({
      type: 'Feature',
      properties: {
        color: colorForMiles(dist),
        name: f.properties.name,
        state: f.properties.state,
        miles,
      },
      geometry: f.geometry,
    });
  }
  return { type: 'FeatureCollection', features };
}
