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
// Colours are luminous-on-dark: on the Style-2 charcoal canvas the particles are
// drawn as additive glow, so a near-black soot would vanish. Each keeps its
// hue's meaning (smoke = warm ash, haze = cool blue, wildfire = purple, …) but
// bright enough to read both as a glowing orb and as a legend swatch.
export const SOURCES = [
  {
    key: 'soot',
    label: 'Combustion soot',
    color: '#CBBDA6',
    size: [1.4, 2.8],
    blurb:
      'Black-carbon particles straight from burning fuel — vehicle exhaust, power plants, wood and coal smoke. The core of urban PM2.5.',
  },
  {
    key: 'brake',
    label: 'Road & brake dust',
    color: '#DE9440',
    size: [2.5, 4.5],
    blurb:
      'Non-tailpipe traffic particles: worn brake pads and tires plus road grit stirred back into the air. Rises with traffic, not fuel.',
  },
  {
    key: 'haze',
    label: 'Sulfate & nitrate haze',
    color: '#8FB2E6',
    size: [2, 3.5],
    blurb:
      'Secondary particles that form in the air itself as SO₂ and NO₂ gases react — the fine, milky haze that drifts far downwind of its source.',
  },
  {
    key: 'wildfire',
    label: 'Wildfire char',
    color: '#C06BCB',
    size: [2, 4],
    blurb:
      'Charred organic particles lofted by wildfires. Light enough to travel thousands of miles, so smoke days can hit places far from any fire.',
  },
  // bio currently draws 0 specks — no measured proxy exists for it (see
  // composition() below) and zero must mean zero. Kept for a future pollen feed.
  {
    key: 'bio',
    label: 'Pollen & biological',
    color: '#6BD08F',
    size: [3.5, 6],
    blurb:
      'Living and once-living particles — pollen, mold spores, bacteria. Seasonal and mostly coarse; a big allergy driver.',
  },
];

export const ULTRAFINE = {
  key: 'ultrafine',
  label: 'Ultrafine',
  color: '#F0584A',
  size: [0.55, 1.1],
  blurb:
    'The tiniest particles (under 0.1 µm), mostly from fresh combustion. Too small to register in the PM2.5 mass number, yet small enough to cross from the lungs into the blood.',
};

// The bulk of every breath, by volume. N₂/O₂/Ar are ~99.96% of dry air; all the
// pollution above is the <0.01% leftover. These are drawn to true ratio TO EACH
// OTHER — the pollution sliver is the part that has to be exaggerated to be
// visible at all (disclosed in the UI, never implied as data). Colors: nitrogen
// green, oxygen blue, argon a neutral grey — shared by the two "breath" diagrams
// and the BreathBars chart so the same gas is the same color everywhere.
export const AIR_GASES = [
  { key: 'n2', short: 'N₂', full: 'Nitrogen', pct: 78.09, color: '#57B36F' },
  { key: 'o2', short: 'O₂', full: 'Oxygen', pct: 20.95, color: '#5B8DEF' },
  { key: 'ar', short: 'Ar', full: 'Argon', pct: 0.93, color: '#9AA0A6' },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const AQI_FIELDS = [
  'us_aqi',
  'us_aqi_pm2_5',
  'us_aqi_pm10',
  'us_aqi_ozone',
  'us_aqi_nitrogen_dioxide',
  'us_aqi_sulphur_dioxide',
  'us_aqi_carbon_monoxide',
];

function aqiScaleFromCurrent(current) {
  if (!current) return 1;
  const maxAqi = Math.max(
    ...AQI_FIELDS.map((k) => (typeof current[k] === 'number' ? current[k] : 0)),
    0
  );
  return clamp(maxAqi / 100, 0.5, 2.2);
}

// Density multiplier for the scattered source view. Pollution is well under
// 0.01% of a breath by volume — the field has to stay sparse enough that the
// dark between specks reads as "mostly empty air." More specks make the field
// legible, but overselling density would make clean-ish air look smoggy. This
// only scales the source view — the pollutant rings are untouched.
export function densityScale() {
  if (typeof window === 'undefined') return 1;
  return window.innerWidth < 700 ? 1.2 : 1.9;
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
  const aqiScale = aqiScaleFromCurrent(current);
  // Sparse on purpose: a breath is ~99.99% N₂/O₂/Ar. The swarm is an intensity
  // diagram, not a particle census — keep the field mostly empty dark.
  const total = Math.round(map(ratio, 0, 6, 22, 560) * scale * aqiScale);

  const sources = {};
  for (const s of SOURCES) {
    sources[s.key] = Math.max(0, Math.round(total * comp.fractions[s.key]));
  }
  // Ultrafine dominates the heavy-combustion scenarios (cigarette, joint); a
  // lower multiplier keeps those fields from overwhelming the canvas.
  const ultrafine = Math.round(comp.ultrafineIndex * 85 * scale * aqiScale);

  return { sources, ultrafine, total, fractions: comp.fractions, line, ratio };
}

// ── Pollutant abundance (for the "What pollutants are there" field) ─────────
//
// Counts here are RELATIVE abundances derived from the measured µg/m³ — not
// exceedance over a legal line. Two families, each honest within itself:
//
//   • Gases (O₃, NO₂, SO₂, CO): molecule count ∝ (µg/m³) / molecular weight.
//     So ozone typically outnumbers NO₂ when its mass concentration is higher
//     (nearly identical MWs), and CO can dominate because outdoor CO is often
//     hundreds of µg/m³ with a light molecule.
//   • Particles (PM2.5, PM10, dust): estimated number concentration from mass,
//     assuming spherical particles at a characteristic diameter. Fine PM makes
//     far more particles per µg than coarse dust.
//
// Gases and particles are NOT on the same absolute scale (a cubic meter holds
// ~10¹⁰× more gas molecules than PM particles). Each family gets its own canvas
// budget so both stay visible; the UI caption says so. Zero stays zero.

const AVOGADRO = 6.02214076e23;
const PARTICLE_DENSITY_G_CM3 = 1.5; // typical urban aerosol bulk density

// g/mol — Open-Meteo reports these gases as µg/m³.
const GAS_MW = {
  ozone: 48,
  nitrogen_dioxide: 46,
  sulphur_dioxide: 64,
  carbon_monoxide: 28,
};

// Characteristic aerodynamic diameter (µm) for a rough number-from-mass
// estimate. Not a size distribution — just enough to put fine ≫ coarse.
const PARTICLE_DIAM_UM = {
  pm2_5: 0.5,
  pm10: 5,
  dust: 8,
};

export const POLLUTANT_SPECK_SIZE = {
  pm2_5: [1, 2.5],
  pm10: [2.5, 5.5],
  dust: [4, 7.5],
};
export const GAS_SPECK_SIZE = [1, 1.8];

// Molecules per m³ from a µg/m³ gas reading.
function gasNumberDensity(ugPerM3, mw) {
  return ((ugPerM3 * 1e-6) / mw) * AVOGADRO;
}

// Particles per m³ from a µg/m³ mass reading + characteristic diameter.
function particleNumberDensity(ugPerM3, diamUm) {
  const rCm = (diamUm * 1e-4) / 2;
  const massPerParticleG = (4 / 3) * Math.PI * rCm ** 3 * PARTICLE_DENSITY_G_CM3;
  if (massPerParticleG <= 0) return 0;
  return (ugPerM3 * 1e-6) / massPerParticleG;
}

/**
 * Relative draw counts for the pollutant field based on mass concentration.
 * Returns `{ key, color, size, count, kind, share, kindShare }[]` where `share`
 * is the fraction of total mass across pollutants and `kindShare` is the
 * fraction within the gas/particle family.
 */
export function pollutantAbundance(current, { aqiScale } = {}) {
  const scale = densityScale();
  const aqiFactor = clamp(aqiScale ?? 1, 0.4, 2.4);
  // Canvas budget for the total mass-based field (shared across gases + particles).
  // Kept lower than the source-view budget so the field doesn't read denser.
  const totalBudget = Math.round(320 * scale * aqiFactor);

  const gases = [];
  const particles = [];

  // Iterate known keys so this module doesn't hard-depend on POLLUTANTS order;
  // colors are filled by the sketch from POLLUTANTS.
  for (const key of Object.keys(GAS_MW)) {
    const ug = current[key];
    if (ug == null || ug <= 0) continue;
    gases.push({ key, raw: ug });
  }
  for (const key of Object.keys(PARTICLE_DIAM_UM)) {
    const ug = current[key];
    if (ug == null || ug <= 0) continue;
    particles.push({ key, raw: ug });
  }

  const gasTotal = gases.reduce((a, g) => a + g.raw, 0) || 1;
  const particleTotal = particles.reduce((a, g) => a + g.raw, 0) || 1;
  const totalSoft = gasTotal + particleTotal || 1;

  // Mass-proportional shares; small species can fall to the minimum dot floor.
  return [
    ...gases.map((g) => {
      return {
        key: g.key,
        kind: 'gas',
        raw: g.raw,
        share: g.raw / totalSoft,
        kindShare: g.raw / gasTotal,
        count: Math.max(g.raw > 0 ? 3 : 0, Math.round((g.raw / totalSoft) * totalBudget)),
        size: GAS_SPECK_SIZE,
      };
    }),
    ...particles.map((g) => {
      return {
        key: g.key,
        kind: 'particle',
        raw: g.raw,
        share: g.raw / totalSoft,
        kindShare: g.raw / particleTotal,
        count: Math.max(g.raw > 0 ? 3 : 0, Math.round((g.raw / totalSoft) * totalBudget)),
        size: POLLUTANT_SPECK_SIZE[g.key] ?? GAS_SPECK_SIZE,
      };
    }),
  ];
}

