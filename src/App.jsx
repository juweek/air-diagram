import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import AirPage from './pages/AirPage';
import { Loading } from './components/Status';

// The monitor-gap map pulls in MapLibre (~230 KB gzip) + the projected assets,
// so it's route-lazy — only a '/map' visit pays for it; the lookup stays light.
const MonitorMap = lazy(() => import('./pages/MonitorMap'));

/**
 * Single-purpose tool: '/' is the air diagram (baseline atmosphere), and every
 * result is a URL — /:query (a zip or city). A shareable/embeddable address and
 * the catch-all keeps a bad link rendering the app, not a 404. Router basename
 * keeps links correct if the app is served from a subpath (import.meta.env.
 * BASE_URL === the `base` knob in vite.config.js).
 */
export default function App() {
  return (
    <Router
      basename={import.meta.env.BASE_URL}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Layout>
        <Routes>
          <Route path="/" element={<AirPage />} />
          {/* Static segment — React Router ranks it above /:query, so a place
              can't shadow the map (and "map" isn't a real lookup anyway). */}
          <Route
            path="/map"
            element={
              <Suspense fallback={<Loading label="Loading the monitor map…" />}>
                <MonitorMap />
              </Suspense>
            }
          />
          <Route path="/:query" element={<AirPage />} />
          <Route path="*" element={<AirPage />} />
        </Routes>
      </Layout>
    </Router>
  );
}
