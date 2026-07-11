import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { getAirnow, getMonitorStatus } from './api/_airnow.js';

// `base` is the ONE knob for serving from a subpath (e.g. embedded under
// /tools/air/). On Vercel/Cloudflare root deploys, leave it '/'.
// Override per-build with:  VITE_BASE=/tools/air/ npm run build
export default defineConfig(({ mode }) => {
  // '' prefix → load ALL env vars (incl. the server-only AIRNOW_API_KEY, which
  // is never exposed to the client — it only reaches the dev middleware below).
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: process.env.VITE_BASE || '/',
    plugins: [
      react(),
      // Dev-only mirror of the Vercel function api/airnow.js, so `npm run dev`
      // serves /api/airnow with the same logic (prod uses the real function).
      {
        name: 'dev-airnow-proxy',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url) return next();
            const u = new URL(req.url, 'http://localhost');
            let data;
            if (u.pathname === '/api/airnow') {
              data = await getAirnow(
                u.searchParams.get('lat'),
                u.searchParams.get('lon'),
                env.AIRNOW_API_KEY
              );
            } else if (u.pathname === '/api/monitor-status') {
              data = await getMonitorStatus(env.AIRNOW_API_KEY);
            } else {
              return next();
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          });
        },
      },
    ],
    // p5 is deliberately one big lazy chunk (see src/viz/P5Sketch.jsx); don't
    // warn about it on every build.
    build: { chunkSizeWarningLimit: 1200 },
  };
});
