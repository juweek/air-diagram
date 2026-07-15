// The "show sky?" background: what color is the sky over this place right now?
//
// Two honest, cheap pieces (no dataset, no network):
//
//  1. WHERE IS THE SUN — solar elevation + hour angle from lat/lon + the current
//     UTC time, using the NOAA "General Solar Position Calculations"
//     approximation (fractional-year → equation of time + declination → hour
//     angle → elevation). Accurate to ~0.1–0.2°, which is far finer than any
//     color step below can show. No timezone lookup needed: the math runs in
//     UTC and longitude carries the local solar time. Hour angle tells dawn
//     from dusk at the same elevation (morning vs afternoon).
//
//  2. WHAT COLOR IS THAT — a gradient ramp keyed to twilight phases plus a
//     distinct high-noon wash. A physical scattering model (Preetham /
//     Hosek-Wilkie) would be more "accurate" but costs a shader pipeline and
//     would render a white-blue noon sky the luminous particles could never
//     survive on. So the ramp is deliberately TONE-MAPPED DARK — the hue and
//     the day/night arc are real; the brightness is capped so the additive
//     orbs stay legible (that's also why the toggle defaults to charcoal).

const RAD = Math.PI / 180;

// { elevationDeg, hourAngleDeg }. hourAngleDeg < 0 → morning (sun rising);
// > 0 → afternoon (sun setting). ~0 at local solar noon.
export function solarPosition(latDeg, lonDeg, date = new Date()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const hourUTC =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Fractional year, radians.
  const g = ((2 * Math.PI) / 365) * (dayOfYear + (hourUTC - 12) / 24);

  // Equation of time (minutes) and solar declination (radians) — NOAA series.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // True solar time (minutes) → hour angle (radians).
  const trueSolarMin = hourUTC * 60 + eqTime + 4 * lonDeg;
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;

  const lat = latDeg * RAD;
  const cosZenith =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const elevationDeg = 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
  return { elevationDeg, hourAngleDeg: hourAngle / RAD };
}

// Solar elevation in degrees (negative = below the horizon).
export function solarElevationDeg(latDeg, lonDeg, date = new Date()) {
  return solarPosition(latDeg, lonDeg, date).elevationDeg;
}

// Keyframes: sun elevation → [top, mid, horizon] RGB. Twilight boundaries plus
// a washed high-noon so midday isn't just "brighter morning blue".
const SKY_KEYS = [
  { e: -90, top: [5, 6, 14], mid: [7, 8, 18], hor: [10, 11, 22] }, // deep night
  { e: -18, top: [6, 8, 18], mid: [9, 11, 24], hor: [14, 15, 30] }, // astronomical
  { e: -12, top: [8, 11, 26], mid: [13, 17, 38], hor: [26, 26, 52] }, // nautical
  { e: -6, top: [13, 18, 42], mid: [34, 32, 64], hor: [96, 58, 54] }, // civil
  { e: 0, top: [26, 34, 66], mid: [80, 56, 78], hor: [190, 110, 60] }, // sunrise/set
  { e: 6, top: [42, 62, 102], mid: [92, 98, 120], hor: [186, 142, 92] }, // golden hour
  { e: 18, top: [48, 78, 128], mid: [90, 118, 152], hor: [148, 152, 158] }, // morning / late afternoon
  { e: 35, top: [52, 92, 148], mid: [100, 134, 172], hor: [150, 164, 178] }, // late morning
  // High noon: washed, brighter zenith, cooler horizon — distinct from "day".
  { e: 55, top: [72, 118, 168], mid: [118, 152, 188], hor: [168, 178, 188] },
  { e: 90, top: [78, 124, 172], mid: [124, 158, 192], hor: [172, 182, 190] },
];

// Dusk bias (afternoon twilight): warmer / redder horizon than the shared ramp.
const DUSK_BIAS = {
  top: [8, -4, -10],
  mid: [18, -6, -14],
  hor: [28, -8, -22],
};
// Dawn bias (morning twilight): cooler / pinker.
const DAWN_BIAS = {
  top: [-4, 2, 8],
  mid: [6, -2, 4],
  hor: [12, 4, -6],
};

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function applyDayPartBias(stops, elevationDeg, afternoon) {
  // Only color-shift around twilight / golden hour, where dawn ≠ dusk.
  if (elevationDeg > 18 || elevationDeg < -14) return stops;
  const bias = afternoon ? DUSK_BIAS : DAWN_BIAS;
  // Peak bias near the horizon (e≈0); fade out by ±18°.
  const t = clamp01(1 - Math.abs(elevationDeg) / 18) * 0.85;
  const keys = ['top', 'mid', 'hor'];
  return stops.map((s, i) =>
    s.map((v, c) => Math.round(Math.min(255, Math.max(0, v + bias[keys[i]][c] * t))))
  );
}

// A cloudy sky loses its blue and flattens toward grey; rain darkens the whole
// vault. Both are applied AFTER the clear-sky ramp so the sun's arc still shows
// through — an overcast noon is a bright flat grey, an overcast night nearly
// black. `weather = { cloudCover 0-100, precip mm }`.
//   • cloud: pull each stop toward its own grey (equal R=G=B at its luminance),
//     and collapse the top→horizon contrast so the gradient reads as flat deck.
//   • rain: multiply everything down toward dark slate.
function applyWeather(stops, weather) {
  if (!weather) return stops;
  const cloud = clamp01((weather.cloudCover ?? 0) / 100);
  const rain = clamp01((weather.precip ?? 0) / 4); // ~4 mm/h reads as heavy

  let out = stops;
  if (cloud > 0) {
    const k = cloud * 0.8; // never a totally featureless plate
    const greyed = out.map(([r, g, b]) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Nudge grey slightly blue-cool so overcast doesn't read as sepia.
      const grey = [lum * 0.96, lum * 0.99, lum * 1.05];
      return [r + (grey[0] - r) * k, g + (grey[1] - g) * k, b + (grey[2] - b) * k];
    });
    // Flatten: at full overcast every stop converges on the mid tone.
    const mid = greyed[1];
    out = greyed.map((s) => s.map((v, i) => v + (mid[i] - v) * (cloud * 0.55)));
  }
  if (rain > 0) {
    const dark = 1 - rain * 0.4;
    out = out.map((s) => s.map((v) => v * dark));
  }
  return out.map((s) => s.map((v) => Math.round(Math.min(255, Math.max(0, v)))));
}

// Elevation (+ optional weather + morning/afternoon) → three gradient stops.
// `opts.afternoon` (default false) separates dusk from dawn at the same elev.
export function skyStops(elevationDeg, weather = null, opts = {}) {
  const afternoon = !!opts.afternoon;
  const e = Math.min(90, Math.max(-90, elevationDeg));
  let lo = SKY_KEYS[0];
  let hi = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (e >= SKY_KEYS[i].e && e <= SKY_KEYS[i + 1].e) {
      lo = SKY_KEYS[i];
      hi = SKY_KEYS[i + 1];
      break;
    }
  }
  const t = hi.e === lo.e ? 0 : (e - lo.e) / (hi.e - lo.e);
  let clear = [lerp(lo.top, hi.top, t), lerp(lo.mid, hi.mid, t), lerp(lo.hor, hi.hor, t)];
  clear = applyDayPartBias(clear, e, afternoon);
  return applyWeather(clear, weather);
}

// WMO weather codes → a short label for the sky caption (grouped, not every
// code — the reader wants "light rain", not "code 61"). See open-meteo docs.
function wmoLabel(code) {
  if (code == null) return null;
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 65) return 'rain';
  if (code === 66 || code === 67) return 'freezing rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'thunderstorm';
  return null;
}

// The place's current wall-clock time, e.g. "3:47 pm", from the UTC offset the
// weather feed reports. Null when we have no offset (no phase-word stand-in —
// the caption shows only time, conditions, and temperature).
function localClock(utcOffsetSec) {
  if (utcOffsetSec == null) return null;
  const d = new Date(Date.now() + utcOffsetSec * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// A one-line caption for the "show sky?" toggle: just the factual readings —
// local clock time, conditions from WMO, temperature. No phase-of-day words.
// e.g. "12:08 pm · mostly clear · 83°F"
export function skyCaption(weather) {
  const parts = [];
  const clock = localClock(weather?.utcOffsetSec);
  if (clock) parts.push(clock);
  const cond = wmoLabel(weather?.code);
  if (cond) parts.push(cond);
  else if (weather?.cloudCover != null) {
    parts.push(weather.cloudCover > 70 ? 'overcast' : weather.cloudCover > 30 ? 'partly cloudy' : 'clear');
  }
  if (weather?.tempF != null) parts.push(`${Math.round(weather.tempF)}°F`);
  return parts.join(' · ');
}
