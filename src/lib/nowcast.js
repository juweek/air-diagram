// EPA NowCast for PM2.5.
//
// The number in your weather app usually isn't a single instantaneous reading —
// it's the NowCast, a weighted average of the last 12 hours that leans harder
// on recent hours when conditions are changing fast. We compute it ourselves
// from Open-Meteo's hourly PM2.5 so the headline reflects the same method AirNow
// uses, not just "the concentration at this exact minute."

// Weighted average of up to 12 hourly concentrations, most-recent-first.
// Weight factor is derived from how much the readings swing over the window:
// stable air -> flatter weighting; volatile air -> recent hours dominate.
export function nowcastConcentration(values) {
  const present = values.filter((v) => v != null && !Number.isNaN(v));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];

  const max = Math.max(...present);
  const min = Math.min(...present);
  // Rate of change, 0..1. Clamped to a floor of 0.5 per the EPA algorithm.
  let weight = max === 0 ? 1 : 1 - (max - min) / max;
  if (weight < 0.5) weight = 0.5;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i++) {
    const c = values[i];
    if (c == null || Number.isNaN(c)) continue;
    const w = Math.pow(weight, i);
    numerator += c * w;
    denominator += w;
  }
  return denominator ? numerator / denominator : null;
}

// EPA PM2.5 AQI breakpoints, updated in 2024 (the "Good" ceiling dropped from
// 12.0 to 9.0 µg/m³). Concentrations are truncated to 0.1 µg/m³ before lookup.
const PM25_BREAKPOINTS = [
  { cLow: 0.0, cHigh: 9.0, aqiLow: 0, aqiHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, aqiLow: 51, aqiHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aqiLow: 101, aqiHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, aqiLow: 151, aqiHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, aqiLow: 201, aqiHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, aqiLow: 301, aqiHigh: 500 },
];

// PM10 breakpoints (µg/m³, 24-hr) — used to derive scenario AQIs so the meter
// always agrees with the concentrations shown (the dust-storm preset is
// PM10-driven). Concentrations are truncated to integers per EPA.
const PM10_BREAKPOINTS = [
  { cLow: 0, cHigh: 54, aqiLow: 0, aqiHigh: 50 },
  { cLow: 55, cHigh: 154, aqiLow: 51, aqiHigh: 100 },
  { cLow: 155, cHigh: 254, aqiLow: 101, aqiHigh: 150 },
  { cLow: 255, cHigh: 354, aqiLow: 151, aqiHigh: 200 },
  { cLow: 355, cHigh: 424, aqiLow: 201, aqiHigh: 300 },
  { cLow: 425, cHigh: 604, aqiLow: 301, aqiHigh: 500 },
];

// The EPA scale tops out at 500 ("beyond the AQI"), so both converters clamp.
function breakpointAqi(breakpoints, c) {
  const band =
    breakpoints.find((b) => c >= b.cLow && c <= b.cHigh) ??
    breakpoints[breakpoints.length - 1];
  const aqi =
    ((band.aqiHigh - band.aqiLow) / (band.cHigh - band.cLow)) * (c - band.cLow) +
    band.aqiLow;
  return Math.min(500, Math.round(aqi));
}

export function pm25Aqi(concentration) {
  if (concentration == null) return null;
  return breakpointAqi(PM25_BREAKPOINTS, Math.trunc(concentration * 10) / 10);
}

export function pm10Aqi(concentration) {
  if (concentration == null) return null;
  return breakpointAqi(PM10_BREAKPOINTS, Math.trunc(concentration));
}

// Given an array of the last 12 hourly PM2.5 values (most-recent-first),
// return the NowCast concentration and its AQI.
export function nowcastAqi(hourlyPm25) {
  const concentration = nowcastConcentration(hourlyPm25);
  return { concentration, aqi: pm25Aqi(concentration) };
}
