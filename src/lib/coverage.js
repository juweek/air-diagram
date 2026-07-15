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

// ── Value choropleths (actual live AQI, not just coverage) ──────────────────
//
// These color the map by the NEAREST monitor's live AQI category, then FADE
// that color toward the charcoal background as the county gets farther from a
// real reading. The hue answers "what's the nearest measured air like?"; the
// fade answers "how much should you trust that here?" — the further from a
// monitor, the fainter, because that's exactly how much of a guess it is.
//
// This is deliberately nearest-neighbour + a confidence fade, NOT inverse-
// distance interpolation (IDW). IDW would blend neighbours into a smooth,
// confident-looking surface — which is the very illusion this piece exists to
// puncture. Fading with distance keeps the guesswork visible.

const GROUND_HEX = '#1f1c19'; // the charcoal map floor colours fade toward
const FADE_MILES = 160; // distance at which a reading is essentially a guess
const FADE_FLOOR = 0.15; // faintest a far county still shows (never fully gone)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
// Mix a toward b by t (0 = all a, 1 = all b).
function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t));
}
// Confidence 1 (at a monitor) → FADE_FLOOR (>= FADE_MILES away), linear between.
function fadeStrength(dist) {
  const t = Math.max(0, Math.min(dist / FADE_MILES, 1));
  return FADE_FLOOR + (1 - FADE_FLOOR) * (1 - t);
}
// Category color faded toward the background by distance (strength 1 = full).
function fadedColor(catColor, strength) {
  return mixHex(catColor, GROUND_HEX, 1 - strength);
}

// Nearest live monitor to a point: { cat, aqi, dist } (miles), or null if none.
function nearestSite(lat, lon, sites) {
  const mpdLon = 69 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  let bcat = 0;
  let baqi = null;
  for (const s of sites) {
    const dLat = (lat - s[0]) * 69;
    const dLon = (lon - s[1]) * mpdLon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < best) {
      best = d2;
      bcat = s[3];
      baqi = s[2];
    }
  }
  if (best === Infinity) return null;
  return { cat: bcat, aqi: baqi, dist: Math.sqrt(best) };
}

function geomBBox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polys) {
    for (const [px, py] of rings[0]) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  return { minX, minY, maxX, maxY };
}
function geomContains(geometry, x, y) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polys) if (polygonContains(x, y, rings)) return true;
  return false;
}

// Grid surface of the nearest monitor's live AQI, faded by distance. Same 0.5°
// land cells as buildCoverageGrid, but colored by the value story, not coverage.
// `sites` = [[lat, lon, aqi, cat], …] live readings; `catColor` = { n: hex }.
export function buildValueGrid(sites, catColor, cell = 0.5) {
  const features = [];
  if (!sites?.length) return { type: 'FeatureCollection', features };
  for (let lon = -125; lon < -66; lon += cell) {
    for (let lat = 24; lat < 50; lat += cell) {
      const cx = lon + cell / 2;
      const cy = lat + cell / 2;
      if (!onLand(cx, cy)) continue;
      const near = nearestSite(cy, cx, sites);
      if (!near || !catColor[near.cat]) continue;
      const color = fadedColor(catColor[near.cat], fadeStrength(near.dist));
      features.push({
        type: 'Feature',
        properties: { color, cat: near.cat, aqi: near.aqi, miles: Math.round(near.dist) },
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

// County choropleth of the LIVE VALUE. A county that actually contains a live
// monitor takes that monitor's category at full strength (the worst one if it
// holds several — AQI is a max, not an average). Every other county borrows its
// nearest monitor's category, faded by how far that monitor is.
// `sites` = [[lat, lon, aqi, cat], …]; `catColor` = { n: hex }.
export async function buildCountyValues(sites, catColor) {
  const { default: usCounties } = await import('../data/usCounties.json');
  const features = [];
  if (!sites?.length) return { type: 'FeatureCollection', features };

  // Precompute each county's bbox + center, then assign each monitor to the one
  // county that contains it (bbox prefilter keeps this cheap).
  const counties = usCounties.features.map((f) => ({
    f,
    bbox: geomBBox(f.geometry),
    center: featureCenter(f.geometry),
    inCat: 0, // worst category of any monitor inside; 0 = none
    inAqi: null,
  }));
  for (const s of sites) {
    const [lat, lon, aqi, cat] = s;
    for (const c of counties) {
      if (lon < c.bbox.minX || lon > c.bbox.maxX || lat < c.bbox.minY || lat > c.bbox.maxY) continue;
      if (geomContains(c.f.geometry, lon, lat)) {
        if (cat > c.inCat) {
          c.inCat = cat;
          c.inAqi = aqi;
        }
        break; // a point lives in exactly one county
      }
    }
  }

  for (const c of counties) {
    if (!c.center) continue;
    const [lon, lat] = c.center;
    let cat;
    let aqi;
    let strength;
    let miles;
    let inside;
    if (c.inCat > 0) {
      cat = c.inCat;
      aqi = c.inAqi;
      strength = 1;
      miles = 0;
      inside = true;
    } else {
      const near = nearestSite(lat, lon, sites);
      if (!near || !catColor[near.cat]) continue;
      cat = near.cat;
      aqi = near.aqi;
      strength = fadeStrength(near.dist);
      miles = Math.round(near.dist);
      inside = false;
    }
    features.push({
      type: 'Feature',
      properties: {
        color: fadedColor(catColor[cat], strength),
        cat,
        aqi,
        miles,
        inside,
        name: c.f.properties.name,
        state: c.f.properties.state,
      },
      geometry: c.f.geometry,
    });
  }
  return { type: 'FeatureCollection', features };
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
