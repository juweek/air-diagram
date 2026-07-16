// ── "What's in a breath" comparison scenarios ────────────────────────────────
// Preset situations you can load the same way you load a place (they share the
// getByQuery path, so /cigarette is a real, shareable address). Each one feeds
// the exact same `current` shape the Open-Meteo API returns, so the source
// split, the pollutant view, and the AQI meter all work unchanged.
//
// IMPORTANT: these are ILLUSTRATIVE — typical published PM2.5-era
// concentrations (µg/m³) for each situation, not a live or specific
// measurement. That's the same "modeled, not measured" spirit as the source
// split itself. Rough figures are drawn from the indoor-air / wildfire-smoke
// literature (e.g. cigarette and cannabis smoke commonly push a room's PM2.5
// into the hundreds; severe wildfire days and dust storms run 200–600+).

import { pm25Aqi, pm10Aqi } from '../lib/nowcast.js';

// A shared source line for every scenario (they aren't from the live API).
const SCENARIO_SOURCE = {
  label: 'Illustrative — typical published PM2.5 levels (EPA / WHO literature)',
  url: 'https://www.epa.gov/pm-pollution/particulate-matter-pm-basics',
};

// Scenario AQIs are DERIVED from the illustrative concentrations through the
// same EPA breakpoints the live path uses, so the meter can never disagree
// with the numbers beside it. (They were once hand-set literals; the cigarette
// preset claimed AQI 425 while its own 350 µg/m³ computes to 500.)
function scenarioAqi(current) {
  return Math.max(pm25Aqi(current.pm2_5) ?? 0, pm10Aqi(current.pm10) ?? 0);
}

// value order below mirrors the API keys the rest of the app reads.
export const SCENARIOS = [
  {
    id: 'cigarette',
    label: 'A room with a lit cigarette',
    blurb:
      'Indoor air beside a burning cigarette. PM2.5 commonly runs 300–500 µg/m³ — nearly all combustion soot, with a huge ultrafine swarm the mass number never counts.',
    current: {
      pm2_5: 350,
      pm10: 380,
      ozone: 8,
      nitrogen_dioxide: 50,
      sulphur_dioxide: 3,
      carbon_monoxide: 8000,
      dust: 2,
    },
  },
  {
    id: 'cannabis',
    label: 'A room with a lit joint',
    blurb:
      'Indoor cannabis smoke burns at similar temperatures to tobacco and drives PM2.5 just as high — often 400–600 µg/m³, dominated by soot and ultrafine particles.',
    current: {
      pm2_5: 450,
      pm10: 480,
      ozone: 8,
      nitrogen_dioxide: 40,
      sulphur_dioxide: 3,
      carbon_monoxide: 6000,
      dust: 2,
    },
  },
  {
    id: 'wildfire',
    label: 'A severe wildfire-smoke day',
    blurb:
      'Outdoor air under thick wildfire smoke (think the 2023 East-Coast haze). PM2.5 around 250 µg/m³ — mostly wildfire char and soot, with little of the traffic gases.',
    current: {
      pm2_5: 250,
      pm10: 270,
      ozone: 45,
      nitrogen_dioxide: 8,
      sulphur_dioxide: 6,
      carbon_monoxide: 900,
      dust: 6,
    },
  },
  {
    id: 'traffic',
    label: 'A busy roadside at rush hour',
    blurb:
      'Standing at a congested intersection. PM2.5 is modest (~45 µg/m³) but the air is thick with combustion soot and road & brake dust from the traffic right next to you.',
    current: {
      pm2_5: 45,
      pm10: 75,
      ozone: 35,
      nitrogen_dioxide: 130,
      sulphur_dioxide: 9,
      carbon_monoxide: 2200,
      dust: 35,
    },
  },
  {
    id: 'dust-storm',
    label: 'A desert dust storm',
    blurb:
      'Air during a dust storm (Saharan or Southwest-US). PM10 spikes into the hundreds and the breath is overwhelmingly mineral & road dust rather than combustion.',
    current: {
      pm2_5: 120,
      pm10: 600,
      ozone: 20,
      nitrogen_dioxide: 18,
      sulphur_dioxide: 5,
      carbon_monoxide: 500,
      dust: 520,
    },
  },
];

const BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/** Resolve a scenario id → preset + `current` shaped like the live API (with us_aqi). */
export function buildScenario(id) {
  const s = BY_ID[String(id || '').trim().toLowerCase()];
  if (!s) return null;
  return {
    id: s.id,
    label: s.label,
    blurb: s.blurb,
    source: SCENARIO_SOURCE,
    current: { ...s.current, us_aqi: scenarioAqi(s.current) },
  };
}

// If `query` names a scenario, return a result object shaped exactly like the
// live data path (location / current / nowcast) plus a `blurb` and `source`.
// Otherwise null, and the caller falls through to the real geocode + fetch.
export function getScenario(query) {
  const s = buildScenario(query);
  if (!s) return null;
  return {
    location: { name: s.label, latitude: null, longitude: null },
    current: s.current,
    nowcast: null,
    blurb: s.blurb,
    source: s.source,
  };
}
