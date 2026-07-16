import { POLLUTANTS } from '../lib/pollutants.js';
import { nowcastAqi, pm25Aqi } from '../lib/nowcast.js';
import { nearestMonitor, haversineMiles } from '../lib/monitors.js';
import { nearestTypical } from '../lib/typical.js';
import { fetchAirAlerts } from '../lib/nwsAlerts.js';
import { apiUrl } from '../lib/apiBase.js';
import { getScenario } from './scenarios.js';

/**
 * ── LIVE PUBLIC API DATA SOURCE (template "mode 2") ─────────────────────────
 * A plain async function that takes the canonical lookup key (a zip OR a city
 * name) and returns a plain object. No API keys, no serverless proxy — both
 * upstream services are free and CORS-open, so the browser calls them directly.
 *
 *   getByQuery(query) → { location, current, nowcast }
 *
 * The page (src/pages/AirPage.jsx) never changes if this body changes.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ZIP_RE = /^\d{5}$/;

// fetch + JSON with one retry on a transient failure (network blip or a 5xx).
// Every upstream here is a free public service, so a brief retry turns a lot of
// flaky one-off failures into successful lookups instead of a dead-end error.
async function fetchJson(url, { retries = 1, label = 'Lookup' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      // 4xx are real "not found" answers — don't retry those, let the caller
      // turn them into a friendly message. Only retry 5xx / network errors.
      if (res.status >= 500) throw new Error(`${label} failed (${res.status}).`);
      return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr ?? new Error(`${label} failed — try again.`);
}

// Zippopotam is the flakiest dependency in the stack, so a ZIP lookup falls
// back to OpenStreetMap's Nominatim (keyless, CORS-open, postalcode search)
// before giving up — one outage shouldn't blank every ZIP.
async function geocodeZip(zip) {
  try {
    const { ok, data } = await fetchJson(`https://api.zippopotam.us/us/${zip}`, {
      label: 'ZIP lookup',
    });
    const place = ok ? data?.places?.[0] : null;
    if (place) {
      return {
        name: `${place['place name']}, ${place['state abbreviation']} ${zip}`,
        latitude: parseFloat(place.latitude),
        longitude: parseFloat(place.longitude),
      };
    }
  } catch {
    // fall through to the backup geocoder
  }
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('country', 'US');
  url.searchParams.set('postalcode', zip);
  url.searchParams.set('limit', '1');
  const { data } = await fetchJson(url, { label: 'ZIP lookup' });
  const hit = data?.[0];
  if (!hit) throw new Error(`Couldn't find ZIP code ${zip}.`);
  return {
    name: hit.display_name?.split(',').slice(0, 2).join(',').trim() || `ZIP ${zip}`,
    latitude: parseFloat(hit.lat),
    longitude: parseFloat(hit.lon),
  };
}

// ZIP codes go through Zippopotam.us (with a Nominatim backup); anything else
// (city, county, town) goes through Open-Meteo's geocoder. All free, no API key.
export async function geocode(query) {
  const q = query.trim();
  if (ZIP_RE.test(q)) return geocodeZip(q);

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const { data } = await fetchJson(url, { label: 'Location lookup' });
  const hit = data?.results?.[0];
  if (!hit) throw new Error(`Couldn't find a place called "${q}".`);
  return {
    name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

// Pull the last `count` hourly values ending at (or just before) `endTime`,
// most-recent-first, so nowcast.js can weight them.
function recentHourly(hourly, key, endTime, count = 12) {
  const times = hourly?.time ?? [];
  const series = hourly?.[key] ?? [];
  // Index of the hour at or just before the current time.
  let end = times.length - 1;
  if (endTime) {
    const target = endTime.slice(0, 13); // 'YYYY-MM-DDTHH'
    const found = times.findIndex((t) => t.slice(0, 13) === target);
    if (found !== -1) end = found;
  }
  const out = [];
  for (let i = end; i >= 0 && out.length < count; i--) out.push(series[i]);
  return out; // most-recent-first
}

// Same window but keeping the timestamps, oldest-first — feeds the little
// "last 24 hours" trend bars under the AQI gauge.
function recentSeries(hourly, key, endTime, count = 24) {
  const times = hourly?.time ?? [];
  const series = hourly?.[key] ?? [];
  let end = times.length - 1;
  if (endTime) {
    const target = endTime.slice(0, 13);
    const found = times.findIndex((t) => t.slice(0, 13) === target);
    if (found !== -1) end = found;
  }
  const out = [];
  for (let i = Math.max(0, end - count + 1); i <= end; i++) {
    if (series[i] != null) out.push({ time: times[i], value: series[i] });
  }
  return out;
}

export async function fetchAirQuality(latitude, longitude) {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  // Per-pollutant AQIs let the readout say WHICH pollutant is driving the
  // headline — the AQI is a maximum across pollutants, not a summary.
  const AQI_FIELDS = [
    'us_aqi',
    'us_aqi_pm2_5',
    'us_aqi_pm10',
    'us_aqi_ozone',
    'us_aqi_nitrogen_dioxide',
    'us_aqi_sulphur_dioxide',
    'us_aqi_carbon_monoxide',
  ];
  url.searchParams.set('current', [...AQI_FIELDS, ...POLLUTANTS.map((d) => d.key)].join(','));
  // Hourly PM2.5 over the last day feeds the NowCast calculation.
  url.searchParams.set('hourly', 'pm2_5');
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '1');
  // Local timestamps for the place (not GMT) — the trend bars label hours.
  url.searchParams.set('timezone', 'auto');
  const { ok, data } = await fetchJson(url, { label: 'Air quality lookup' });
  if (!ok || !data) throw new Error('Air quality lookup failed — try again.');

  const hourlyPm25 = recentHourly(data.hourly, 'pm2_5', data.current?.time, 12);
  const nowcast = nowcastAqi(hourlyPm25);
  const history = recentSeries(data.hourly, 'pm2_5', data.current?.time, 24);

  return { current: data.current, nowcast, history };
}

// Current weather over the point — cloud cover, precipitation, code and temp —
// from Open-Meteo's forecast API (free, CORS-open, no key, same family as the
// air-quality feed). ONLY used to tint the optional "show sky?" background more
// truthfully (overcast greys it, rain darkens it), so like the alert/monitor
// garnishes it never blocks and resolves to null on any failure. Fahrenheit
// because the audience is US ZIP/city lookups.
async function fetchWeather(latitude, longitude) {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude);
    url.searchParams.set('longitude', longitude);
    url.searchParams.set('current', 'temperature_2m,precipitation,cloud_cover,weather_code,is_day');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('timezone', 'auto');
    const { ok, data } = await fetchJson(url, { label: 'Weather', retries: 0 });
    const c = ok ? data?.current : null;
    if (!c) return null;
    return {
      tempF: c.temperature_2m ?? null,
      precip: c.precipitation ?? 0, // mm in the last hour
      cloudCover: c.cloud_cover ?? 0, // %
      code: c.weather_code ?? null, // WMO code
      isDay: c.is_day === 1,
      // Seconds to add to UTC for the place's wall-clock time — lets the sky
      // caption show the actual local time without a separate timezone lookup.
      utcOffsetSec: data.utc_offset_seconds ?? null,
    };
  } catch {
    return null;
  }
}

// The REAL measured reading, via our own serverless proxy (/api/airnow holds
// the AirNow key server-side). Returns the distilled observation or null — a
// failure or an unmonitored area just means "no measurement, use the model," so
// this never blocks or throws. `distanceMi` is how far the actual reporting
// area sits from the searched point.
async function fetchMeasured(latitude, longitude) {
  try {
    const { ok, data } = await fetchJson(
      apiUrl(`/api/airnow?lat=${latitude}&lon=${longitude}`),
      { label: 'Measured', retries: 0 }
    );
    if (!ok || !data?.available) return null;
    const distanceMi =
      data.areaLat != null && data.areaLon != null
        ? Math.round(haversineMiles(latitude, longitude, data.areaLat, data.areaLon))
        : null;
    return { ...data, distanceMi };
  } catch {
    return null;
  }
}

// The template data-function: canonical key (zip, city, or scenario id) → plain
// result object. Scenario presets short-circuit the network entirely.
export async function getByQuery(query) {
  const scenario = getScenario(query);
  if (scenario) return scenario;

  const location = await geocode(query);
  const { latitude, longitude } = location;
  // The nearest-monitor lookup (how far the closest regulatory PM2.5 monitor is)
  // and the real measured reading both run alongside the model fetch and never
  // block the result — each resolves to null on failure.
  const monitorP = nearestMonitor(latitude, longitude);
  const measuredP = fetchMeasured(latitude, longitude);
  // Any active NWS air-quality alert for this point (Air Quality Alert, smoke,
  // dust, ozone…). Garnish like the other two: null on failure, never blocks.
  const alertsP = fetchAirAlerts(latitude, longitude);
  // Current weather for the optional sky tint — also a null-on-failure garnish.
  const weatherP = fetchWeather(latitude, longitude);

  try {
    const { current, nowcast, history } = await fetchAirQuality(latitude, longitude);
    return {
      location,
      current,
      nowcast,
      history,
      monitor: await monitorP,
      measured: await measuredP,
      alerts: await alertsP,
      weather: await weatherP,
    };
  } catch (liveErr) {
    // The live CAMS model API is a single point of failure. Rather than blank
    // the page, fall back to the nearest site's typical 2024 annual-average
    // PM2.5 — clearly flagged so it never reads as today's live air. A real
    // measured reading, if we got one, still rides along as the headline.
    const typical = await nearestTypical(latitude, longitude);
    const measured = await measuredP;
    if (!typical && !measured) throw liveErr; // nothing to show → surface error
    const current = typical
      ? { pm2_5: typical.pm2_5, us_aqi: pm25Aqi(typical.pm2_5) }
      : {};
    return {
      location,
      current,
      nowcast: null,
      monitor: await monitorP,
      measured,
      alerts: await alertsP,
      weather: await weatherP,
      fallback: typical ? { kind: 'typical-annual', distanceMi: typical.distanceMi } : null,
    };
  }
}
