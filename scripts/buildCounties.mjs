#!/usr/bin/env node
// Compile a simplified contiguous-US county GeoJSON for the monitor-gap
// choropleth. Source: plotly's Census-derived counties (names + STATE FIPS).
//
// Run when refreshing boundaries (rare — county lines almost never change):
//   node scripts/buildCounties.mjs
//
// Output: src/data/usCounties.json — lightweight polygons + {name, state}.
// Runtime colors them from the monitor list (no FIPS join required).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../src/data/usCounties.json');
const SRC =
  process.argv[2] ||
  'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

// Contiguous US + DC. Drop AK (02), HI (15), PR (72), territories.
const KEEP = new Set([
  '01', '04', '05', '06', '08', '09', '10', '11', '12', '13', '16', '17', '18', '19',
  '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33',
  '34', '35', '36', '37', '38', '39', '40', '41', '42', '44', '45', '46', '47', '48',
  '49', '50', '51', '53', '54', '55', '56',
]);

const FIPS_TO_ABBR = {
  '01': 'AL', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI',
  '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK',
  '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX',
  '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
};

// Round + drop near-duplicate vertices. 2 decimals ≈ 1 km — fine for a
// national choropleth and the main size win vs the 3 MB source file.
function simplifyRing(ring, decimals = 2) {
  const f = 10 ** decimals;
  const out = [];
  let prev = null;
  for (const [x, y] of ring) {
    const px = Math.round(x * f) / f;
    const py = Math.round(y * f) / f;
    const key = `${px},${py}`;
    if (key === prev) continue;
    out.push([px, py]);
    prev = key;
  }
  if (out.length >= 2) {
    const [a, b] = out[0];
    const [c, d] = out[out.length - 1];
    if (a !== c || b !== d) out.push([a, b]);
  }
  return out.length >= 4 ? out : null;
}

function simplifyCoords(coords, type) {
  if (type === 'Polygon') {
    const rings = coords.map((r) => simplifyRing(r)).filter(Boolean);
    return rings.length ? rings : null;
  }
  // MultiPolygon
  const polys = coords
    .map((poly) => poly.map((r) => simplifyRing(r)).filter(Boolean))
    .filter((poly) => poly.length > 0);
  return polys.length ? polys : null;
}

const raw = await (await fetch(SRC)).json();
const features = [];
for (const f of raw.features) {
  const stateFips = String(f.properties.STATE).padStart(2, '0');
  if (!KEEP.has(stateFips)) continue;
  const type = f.geometry.type;
  const coords = simplifyCoords(f.geometry.coordinates, type);
  if (!coords) continue;
  features.push({
    type: 'Feature',
    properties: {
      name: f.properties.NAME,
      state: FIPS_TO_ABBR[stateFips] ?? stateFips,
    },
    geometry: { type, coordinates: coords },
  });
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${features.length} counties → ${OUT} (${kb} KB)`);
