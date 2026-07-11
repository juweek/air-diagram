// The source-composition model.
//
// IMPORTANT, and stated plainly in the UI: the official PM2.5 number is a
// single mass figure. It does NOT tell you what the particles are or where they
// came from — and ultrafine particles aren't in it at all. So this split is
// *modeled*, not measured. We take the total PM2.5 mass and apportion it across
// plausible source buckets using the other pollutants as proxies (NO₂ and CO
// for combustion, SO₂ for sulfate haze, the dust channel for road/mineral
// dust), then add an *estimated* ultrafine swarm the mass number never counted.
// It's an illustration of the blog's point, not an emissions inventory.

import { PM25_LINES } from './pollutants.js';

// The visible fraction of a breath, by source. Sizes are rough draw radii in
// px; ultrafine is deliberately the smallest and is tracked separately because
// it lives outside the regulated mass number.
export const SOURCES = [
  { key: 'soot', label: 'Combustion soot', color: '#2A2A28', size: [2, 4] },
  { key: 'brake', label: 'Road & brake dust', color: '#B56515', size: [4, 7] },
  { key: 'haze', label: 'Sulfate & nitrate haze', color: '#8FA3C4', size: [3, 5] },
  { key: 'wildfire', label: 'Wildfire char', color: '#8F3F97', size: [3, 6] },
  // bio currently draws 0 specks — no measured proxy exists for it (see
  // composition() below) and zero must mean zero. Kept for a future pollen feed.
  { key: 'bio', label: 'Pollen & biological', color: '#3B9C46', size: [5, 9] },
];

export const ULTRAFINE = {
  key: 'ultrafine',
  label: 'Ultrafine — never counted',
  color: '#D6392F',
  size: [1, 2],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

// Density multiplier for the scattered source view. More specks make the field
// legible, but the source view redraws every speck each frame, so the ceiling
// is lower on phones than on desktop. This only scales the source view — the
// pollutant rings are untouched.
export function densityScale() {
  if (typeof window === 'undefined') return 1;
  return window.innerWidth < 700 ? 2 : 3.5;
}

// Turn a set of current readings into source fractions (summing to 1) plus an
// ultrafine "index" (0..3, a rough intensity, not a mass).
export function composition(current) {
  const pm25 = current.pm2_5 ?? 0;
  const no2 = current.nitrogen_dioxide ?? 0;
  const so2 = current.sulphur_dioxide ?? 0;
  const co = current.carbon_monoxide ?? 0;
  const dust = current.dust ?? 0;

  // Proxy weights, each tied DIRECTLY to a measured pollutant so a source that
  // isn't in the air reads ~0 (no artificial baselines — an absent input must
  // not conjure particles). These are relative, then normalized, so only the
  // ratios between buckets matter.
  const combustion = no2 / 40 + co / 500; // traffic / fuel burning (NO₂, CO)
  const sulfate = so2 / 20; // sulfate & nitrate haze (SO₂)
  const dustFrac = dust / 25; // road + wind-blown mineral dust (dust channel)
  // Biological aerosols (pollen, spores) have NO measured proxy in these API
  // fields, so per the zero-means-zero rule they get no share — a fixed floor
  // here once conjured up to ~19% "pollen" in clean air out of thin air. If a
  // real proxy ever exists (e.g. a pollen API), wire it in; until then, 0.
  const bioFrac = 0;
  // Wildfire signature: a lot of PM2.5 that ISN'T explained by traffic gases.
  const smoke = pm25 > 35 && no2 < 15 ? map(pm25, 35, 120, 0, 1.2) : 0;

  const raw = {
    soot: combustion,
    brake: dustFrac,
    haze: sulfate,
    wildfire: clamp(smoke, 0, 2),
    bio: bioFrac,
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;

  const fractions = {};
  for (const key of Object.keys(raw)) fractions[key] = raw[key] / total;

  // Ultrafine tracks combustion (tailpipes, gas stoves) and is not part of the
  // PM2.5 mass, so it never moves the legal/WHO count. It's an estimate.
  const ultrafineIndex = clamp(combustion, 0, 3);

  return { fractions, ultrafineIndex, pm25 };
}

// How many particles of each kind to draw, given the active reference line.
// Total scales with how far PM2.5 sits over the chosen line — so flipping to
// the WHO line (which is lower) multiplies the specks without the air changing.
// Ultrafine is independent of the line: what's unmeasured never shows up as a
// problem, and never gets "cleared" by a looser standard either.
export function particleBreakdown(current, mode = 'legal') {
  const comp = composition(current);
  const line = mode === 'who' ? PM25_LINES.who : PM25_LINES.legal;
  const ratio = clamp((current.pm2_5 ?? 0) / line, 0, 6);
  const scale = densityScale();
  const total = Math.round(map(ratio, 0, 6, 40, 1050) * scale);

  const sources = {};
  for (const s of SOURCES) {
    sources[s.key] = Math.max(0, Math.round(total * comp.fractions[s.key]));
  }
  // Ultrafine dominates the heavy-combustion scenarios (cigarette, joint); a
  // lower multiplier keeps those fields from overwhelming the canvas.
  const ultrafine = Math.round(comp.ultrafineIndex * 150 * scale);

  return { sources, ultrafine, total, fractions: comp.fractions, line, ratio };
}
