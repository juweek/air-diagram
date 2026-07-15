// Where the serverless AirNow proxies (/api/airnow, /api/monitor-status) live.
//
// By default they're SAME-ORIGIN ('/api/…') — correct on Vercel, where the
// functions in /api are deployed alongside the site, and in `npm run dev` (the
// vite middleware in vite.config.js mirrors them).
//
// A static host like GitHub Pages CAN'T run those functions. Point this at a
// deployment that can by setting VITE_API_BASE at build time, e.g.
//   VITE_API_BASE=https://your-app.vercel.app
// The functions already send `Access-Control-Allow-Origin: *`, so the
// cross-origin call works. Leave it unset and the AirNow-backed features
// (the "Measured" headline and the Live-AQI map layer) simply degrade — the
// tool still runs entirely on the free, key-less, CORS-open APIs.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const apiUrl = (path) => `${BASE}${path}`;
