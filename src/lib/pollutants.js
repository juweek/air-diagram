// One entry per pollutant returned by the Open-Meteo air quality API.
//
// `range` is the typical urban span in µg/m³: `range[0]` maps to 0 (barely
// there) and `range[1]` maps to 1 (a high day for a US city). It drives the
// readout level bars.
//
// `who` and `legal` are two reference lines in µg/m³ — the WHO 2021 health
// guideline and the US EPA legal standard (NAAQS). The legal line is always
// looser (higher) than the health line; that gap is the whole point of the
// piece. Averaging periods are mixed (PM2.5 is annual, most others 24-hour or
// 1-hour) so these are illustrative reference lines, not a compliance
// calculation — see the notes below.
//
// Colours are luminous-on-dark (Style-2 charcoal canvas): each pollutant keeps a
// distinct hue, bright enough to glow as a ring orb and to read as a legend dot
// / bar fill. 6-digit hex — the additive glow supplies its own soft falloff.
export const POLLUTANTS = [
  {
    key: 'pm2_5',
    label: 'PM2.5',
    name: 'Fine particles',
    form: 'particle', // drawn as orbs in the field
    unit: 'µg/m³',
    range: [0, 40],
    who: 5, // WHO annual guideline
    legal: 9, // EPA annual NAAQS (2024; was 12)
    // Dark blood-red — PM2.5 is the headline health threat, and the ominous hue
    // reads that way against the charcoal (bright enough to still glow additive).
    color: '#C42B22',
    centered: true,
    blurb:
      'Fine particles under 2.5 microns — small enough to lodge deep in the lungs and cross into the blood. Mostly combustion: traffic, smoke, industry.',
  },
  {
    key: 'pm10',
    label: 'PM10',
    name: 'Coarse particles',
    form: 'particle',
    unit: 'µg/m³',
    range: [0, 60],
    who: 45, // WHO 24-hour
    legal: 150, // EPA 24-hour NAAQS
    color: '#D9A93E',
    semiCentered: true,
    blurb:
      'Coarse particles under 10 microns — road grit, construction dust, pollen. Irritates eyes and airways but mostly stops in the nose and throat.',
  },
  {
    key: 'ozone',
    label: 'O₃',
    name: 'Ozone',
    form: 'gas', // drawn as soft haze in the field
    unit: 'µg/m³',
    range: [20, 180],
    who: 100, // WHO 8-hour
    legal: 137, // EPA 8-hour NAAQS (0.070 ppm ≈ 137 µg/m³)
    // Ozone is a gas — drawn as blue smoke in the pollutant field, not orbs.
    color: '#5B90F0',
    blurb:
      'Ground-level ozone — formed when sunlight cooks traffic and industrial gases. A lung irritant that peaks on hot, still afternoons. N95 masks don’t filter it.',
  },
  {
    key: 'nitrogen_dioxide',
    label: 'NO₂',
    name: 'Nitrogen dioxide',
    form: 'gas',
    unit: 'µg/m³',
    range: [0, 60],
    who: 25, // WHO 24-hour
    legal: 188, // EPA 1-hour NAAQS (100 ppb ≈ 188 µg/m³)
    // Green — tailpipe gas, drawn as green smoke in the pollutant field.
    color: '#57B36F',
    blurb:
      'Nitrogen dioxide — the signature gas of tailpipes and gas stoves. Inflames airways; a good tracer of fresh traffic exhaust near you.',
  },
  {
    key: 'sulphur_dioxide',
    label: 'SO₂',
    name: 'Sulfur dioxide',
    form: 'gas',
    unit: 'µg/m³',
    range: [0, 20],
    who: 40, // WHO 24-hour
    legal: 196, // EPA 1-hour NAAQS (75 ppb ≈ 196 µg/m³)
    // Purple — sulfur gas, drawn as purple smoke in the pollutant field.
    color: '#A66BD4',
    blurb:
      'Sulfur dioxide — from burning coal and oil. Irritating on its own, and the gas that later becomes sulfate haze particles downwind.',
  },
  {
    key: 'carbon_monoxide',
    label: 'CO',
    name: 'Carbon monoxide',
    form: 'gas',
    unit: 'µg/m³',
    range: [50, 600],
    who: 4000, // WHO 24-hour (4 mg/m³)
    legal: 40000, // EPA 1-hour NAAQS (35 ppm ≈ 40 mg/m³)
    // White — the odorless combustion gas, drawn as pale smoke in the field.
    color: '#F2F2F2',
    blurb:
      'Carbon monoxide — an odorless combustion gas that binds to blood in place of oxygen. High indoors near flames; usually low outdoors.',
  },
  {
    key: 'dust',
    label: 'Dust',
    name: 'Airborne dust',
    form: 'particle',
    unit: 'µg/m³',
    range: [0, 25],
    who: 45, // no dust-specific guideline; borrow PM10 24-hour
    legal: 150,
    color: '#D98A44',
    blurb:
      'Wind-blown mineral dust — desert plumes, dry fields, unpaved roads. A natural source, but still particulate load on the lungs.',
  },
];

// Quick lookup for tooltips on chips that key by display label ("PM2.5", "O3"…).
export const POLLUTANT_BLURBS = Object.fromEntries(
  POLLUTANTS.map((d) => [d.label, d.blurb])
);
POLLUTANT_BLURBS['O3'] = POLLUTANT_BLURBS['O₃']; // AirNow spells it without the subscript
POLLUTANT_BLURBS['ozone'] = POLLUTANT_BLURBS['O₃']; // the AQI-driver strip uses the word

// The headline pollutant's two lines, pulled out so the source view and the
// legend don't have to dig through POLLUTANTS.
export const PM25_LINES = { who: 5, legal: 9 };

// 0 = bottom of the typical urban range, 1 = a high day. Allowed to run a
// little past 1 so genuinely bad days keep growing.
export function pollutantNorm(def, value) {
  const [min, max] = def.range;
  const norm = (value - min) / (max - min);
  return Math.max(0, Math.min(norm, 1.25));
}

// How many times over the active reference line a reading sits. `mode` is
// 'legal' or 'who'. 1.0 means "exactly at the line"; 2.0 means "twice the
// line". Because the WHO line is lower, flipping to it raises every reading's
// exceedance — which is what makes the same air fill with specks.
export function exceedance(def, value, mode = 'legal') {
  if (value == null) return 0;
  // "current" = today's reading vs a typical urban high for that pollutant
  // (def.range[1]), not against a health or legal line.
  if (mode === 'current') {
    const top = def.range?.[1];
    if (!top) return 0;
    return Math.max(0, value / top);
  }
  const line = mode === 'who' ? def.who : def.legal;
  if (!line) return 0;
  return Math.max(0, value / line);
}

// What to actually DO at a given AQI — compressed from the EPA/AirNow activity
// guidance ("Air Quality Activity Guides" + "When Smoke is in the Air"). Static
// public-health advice keyed to the same category breakpoints as aqiCategory();
// the UI links to AirNow so the reader can see the full guidance.
const AQI_GUIDANCE = [
  { max: 50, text: 'No precautions needed' },
  {
    max: 100,
    text: 'Fine for almost everyone. Unusually sensitive people should consider shortening long, intense outdoor exertion.',
  },
  {
    max: 150,
    text: 'Sensitive groups (asthma, heart or lung disease, kids, older adults): go easier and shorter outdoors. If it’s smoke, an N95 helps outside — cloth and surgical masks don’t.',
  },
  {
    max: 200,
    text: 'Everyone: cut back prolonged outdoor exertion; sensitive groups move activity indoors. Close windows and filter indoor air. In smoke, wear an N95 outside (no mask filters ozone).',
  },
  {
    max: 300,
    text: 'Avoid outdoor exertion entirely. Stay indoors with windows closed and filtered air; wear an N95 if you must go out.',
  },
  {
    max: Infinity,
    text: 'Health-emergency air. Everyone stay indoors with filtered air and avoid all outdoor exposure until it clears.',
  },
];

export function aqiGuidance(aqi) {
  if (aqi == null) return null;
  return AQI_GUIDANCE.find((g) => aqi <= g.max)?.text ?? null;
}

// US EPA AQI categories with their standard colors.
export function aqiCategory(aqi) {
  if (aqi == null) return { name: 'Unknown', color: '#999999' };
  if (aqi <= 50) return { name: 'Good', color: '#3B9C46' };
  if (aqi <= 100) return { name: 'Moderate', color: '#C7A70A' };
  if (aqi <= 150) return { name: 'Unhealthy for sensitive groups', color: '#E07C00' };
  if (aqi <= 200) return { name: 'Unhealthy', color: '#D6392F' };
  if (aqi <= 300) return { name: 'Very unhealthy', color: '#8F3F97' };
  return { name: 'Hazardous', color: '#7E0023' };
}
