// Vercel serverless function: /api/monitor-status
//
// Returns every contiguous-US PM2.5 monitor's CURRENT AQI + category, for the
// map's color-by-status layer. Heavily edge-cached (data is hourly) so it's one
// shared AirNow pull per cache window — protects the rate limit under traffic.
import { getMonitorStatus } from './_airnow.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Cache 15 min, serve-stale up to 1 hr — monitor AQI updates hourly.
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  const data = await getMonitorStatus(process.env.AIRNOW_API_KEY);
  res.status(200).json(data);
}
