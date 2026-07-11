// Vercel serverless function: /api/airnow?lat=..&lon=..
//
// Holds the AirNow API key server-side (AIRNOW_API_KEY env var) so the browser
// never sees it, adds CORS, and caches at the edge (measured data is hourly, so
// a short TTL protects AirNow's ~500 req/hr limit under traffic).
//
// Set the key in Vercel → Settings → Environment Variables as AIRNOW_API_KEY.
import { getAirnow } from './_airnow.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Edge-cache 10 min, serve-stale up to 30 min while revalidating.
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');

  const { lat, lon } = req.query ?? {};
  const data = await getAirnow(lat, lon, process.env.AIRNOW_API_KEY);
  // Always 200 — `available:false` is a normal answer ("no measured reading
  // near here"), not an error the client should choke on.
  res.status(200).json(data);
}
