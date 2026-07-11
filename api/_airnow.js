// Shared AirNow logic — used by the Vercel function (api/airnow.js) AND the
// local dev middleware (vite.config.js), so prod and `npm run dev` behave the
// same. The leading underscore keeps Vercel from routing this as an endpoint.
//
// AirNow returns real MEASURED AQI (from monitors in a reporting area), one
// entry per parameter (O3 / PM2.5 / PM10). It never exposes the API key to the
// browser — the key lives only server-side, injected here.

const ENDPOINT = 'https://www.airnowapi.org/aq/observation/latLong/current/';
const DATA_ENDPOINT = 'https://www.airnowapi.org/aq/data/';

const pad = (n) => String(n).padStart(2, '0');
// AirNow's data API wants UTC hours as 'YYYY-MM-DDTHH'.
function utcHour(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}`;
}

// Every reporting PM2.5 monitor's CURRENT AQI + category, for the map's
// color-by-status layer. One US-wide pull (a few hundred KB) distilled to
// compact [lat, lon, aqi, category] rows — deduped to the latest hour per site.
// Meant to be edge-cached (see api/monitor-status.js), so it's one shared pull
// per cache window, not per visitor. `sites:[]` on any failure (never throws).
export async function getMonitorStatus(apiKey) {
  if (!apiKey) return { sites: [], reason: 'no-key' };
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 3600 * 1000); // 3-hr window (data lags)
  const url = new URL(DATA_ENDPOINT);
  url.searchParams.set('startDate', utcHour(start));
  url.searchParams.set('endDate', utcHour(now));
  url.searchParams.set('parameters', 'PM25');
  url.searchParams.set('BBOX', '-125,24,-66,50'); // contiguous US
  url.searchParams.set('dataType', 'A'); // AQI (not raw concentration)
  url.searchParams.set('format', 'application/json');
  url.searchParams.set('verbose', '0');
  url.searchParams.set('monitorType', '2'); // permanent + mobile
  url.searchParams.set('API_KEY', apiKey);

  let rows;
  try {
    const res = await fetch(url);
    if (!res.ok) return { sites: [], reason: `upstream-${res.status}` };
    rows = await res.json();
  } catch {
    return { sites: [], reason: 'fetch-failed' };
  }
  if (!Array.isArray(rows)) return { sites: [], reason: 'bad-shape' };

  // Keep the most recent row per site (rows are hourly; a site appears once per
  // hour in the window).
  const latest = new Map();
  for (const r of rows) {
    if (r.AQI == null || r.AQI < 0) continue;
    const key = `${r.Latitude},${r.Longitude}`;
    const prev = latest.get(key);
    if (!prev || r.UTC > prev.UTC) latest.set(key, r);
  }
  const sites = [...latest.values()].map((r) => [
    +r.Latitude.toFixed(3),
    +r.Longitude.toFixed(3),
    r.AQI,
    r.Category, // 1 Good … 6 Hazardous
  ]);
  return { sites, observedAt: utcHour(now) + ':00 UTC' };
}

// → a small, browser-safe object. `available:false` (never an error) whenever
// there's no key, no nearby reporting area, or the upstream hiccups — the client
// treats any of those as "no measured reading here, use the model."
export async function getAirnow(lat, lon, apiKey, { distance = 50 } = {}) {
  if (!apiKey) return { available: false, reason: 'no-key' };
  if (lat == null || lon == null) return { available: false, reason: 'missing-latlon' };

  const url = new URL(ENDPOINT);
  url.searchParams.set('format', 'application/json');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('distance', distance); // miles to the nearest reporting area
  url.searchParams.set('API_KEY', apiKey);

  let obs;
  try {
    const res = await fetch(url);
    if (!res.ok) return { available: false, reason: `upstream-${res.status}` };
    obs = await res.json();
  } catch {
    return { available: false, reason: 'fetch-failed' };
  }
  if (!Array.isArray(obs) || obs.length === 0) return { available: false, reason: 'no-station' };

  const parameters = {};
  let aqi = null;
  let driver = null;
  for (const o of obs) {
    if (o.AQI == null) continue;
    parameters[o.ParameterName] = { aqi: o.AQI, category: o.Category?.Name ?? null };
    if (aqi == null || o.AQI > aqi) {
      aqi = o.AQI;
      driver = o.ParameterName;
    }
  }
  if (aqi == null) return { available: false, reason: 'no-aqi' };

  const first = obs[0];
  return {
    available: true,
    reportingArea: first.ReportingArea ?? null,
    stateCode: first.StateCode ?? null,
    // Representative coordinates of the reporting area — the client turns this
    // into "the actual reading is N miles from your search."
    areaLat: first.Latitude ?? null,
    areaLon: first.Longitude ?? null,
    observedAt: `${first.DateObserved} ${String(first.HourObserved).padStart(2, '0')}:00 ${first.LocalTimeZone}`,
    parameters,
    aqi,
    driver, // 'PM2.5' | 'O3' | 'PM10'
  };
}
