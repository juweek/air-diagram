import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import GourmetMediaContainer from '../components/GourmetMediaContainer';
import monitors from '../data/pm25Monitors.json';
import usStates from '../data/usStates.json';
import { buildCoverageGrid, COVERAGE_BANDS, COVERAGE_GAP, pointInUS } from '../lib/coverage';
import { apiUrl } from '../lib/apiBase';

/**
 * THE MONITOR-GAP MAP — the compiled counter-dataset, drawn, in three modes:
 *
 *   • Locations   — every active regulatory PM2.5 monitor as a plain dot.
 *   • Live AQI     — the same monitors colored by their CURRENT AQI category
 *                    (via /api/monitor-status → AirNow), with a category filter.
 *   • Coverage gaps— a land grid colored by distance to the nearest monitor;
 *                    uncovered areas are left blank, so the holes ARE the gaps.
 *
 * A real WebGL map (MapLibre) with NO tile basemap: the only layers are a
 * bundled US-states outline and our own data. No token, no billing, no external
 * tile calls — as self-contained and embeddable as the particle canvas.
 *
 * Route-level lazy-loaded (App.jsx), so MapLibre never touches the initial
 * bundle. Alaska/Hawaii are omitted from this view; the caption keeps counts honest.
 */

// Charcoal-theme map colours (mirror the design tokens in index.css). The map is
// a fixed rectangle, so it uses flat token values rather than the page gradient.
const GROUND = '#1f1c19'; // --ground: the charcoal map floor, matches the page
const LAND = '#d9cdb8'; // --sand: a faint warm landmass, drawn at low opacity
const BORDER = '#a8987e'; // --sand-muted: state outlines
const HALO = '#f6efe0'; // --sand-bright: a light ring around each dot so it pops
const INK = '#383838'; // dark text for the (light) hover popups
const DATA_PRIMARY = '#6FA6FF'; // luminous blue monitor dots on the dark ground
const EMPTY = { type: 'FeatureCollection', features: [] };

// AQI categories (AirNow Category number → label + color; matches pollutants.js).
const CATS = [
  { n: 1, name: 'Good', color: '#3B9C46' },
  { n: 2, name: 'Moderate', color: '#C7A70A' },
  { n: 3, name: 'Sensitive', color: '#E07C00' },
  { n: 4, name: 'Unhealthy', color: '#D6392F' },
  { n: 5, name: 'Very unhealthy', color: '#8F3F97' },
  { n: 6, name: 'Hazardous', color: '#7E0023' },
];
const CAT_BY_N = Object.fromEntries(CATS.map((c) => [c.n, c]));

// The contiguous-US window the states outline covers — filter monitors to match.
const BBOX = { minLon: -125, maxLon: -66.5, minLat: 24, maxLat: 49.5 };
const inBox = (lat, lon) =>
  lon >= BBOX.minLon && lon <= BBOX.maxLon && lat >= BBOX.minLat && lat <= BBOX.maxLat;

const SOURCE = {
  label: 'EPA AQS active PM2.5 monitors (2025); live AQI via AirNow (EPA)',
  url: 'https://aqs.epa.gov/aqsweb/airdata/download_files.html',
};

export default function MonitorMap() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState('locations'); // 'locations' | 'status' | 'coverage'
  const [hidden, setHidden] = useState(() => new Set()); // categories hidden in Live AQI
  const [statusGeo, setStatusGeo] = useState(null);
  const [statusMeta, setStatusMeta] = useState(null); // {counts, observedAt} or {error}
  const [coverageGeo, setCoverageGeo] = useState(null);

  // Static monitor points (contiguous US), built once.
  const { points, shownCount, total } = useMemo(() => {
    const shown = monitors.filter(([lat, lon]) => inBox(lat, lon));
    return {
      total: monitors.length,
      shownCount: shown.length,
      points: {
        type: 'FeatureCollection',
        features: shown.map(([lat, lon, name, county, state]) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { name, county, state },
        })),
      },
    };
  }, []);

  // ── create the map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': GROUND } }] },
      center: [-96, 38],
      zoom: 3.2,
      minZoom: 2.5,
      maxZoom: 9,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });

    map.on('load', () => {
      map.addSource('states', { type: 'geojson', data: usStates });
      map.addSource('coverage', { type: 'geojson', data: EMPTY });
      map.addSource('monitors', { type: 'geojson', data: points });
      map.addSource('status', { type: 'geojson', data: EMPTY });

      map.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { 'fill-color': LAND, 'fill-opacity': 0.12 } });
      // Coverage sits above land fill but below borders + dots. Opacity is
      // per-feature so the deep-red gaps read stronger than the covered bands.
      map.addLayer({ id: 'coverage', type: 'fill', source: 'coverage', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.65 } });
      map.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': BORDER, 'line-width': 0.7, 'line-opacity': 0.35 } });

      const radius = ['interpolate', ['linear'], ['zoom'], 3, 2, 5, 3.5, 8, 7];
      map.addLayer({
        id: 'monitors',
        type: 'circle',
        source: 'monitors',
        paint: { 'circle-color': DATA_PRIMARY, 'circle-opacity': 0.9, 'circle-stroke-color': HALO, 'circle-stroke-width': 0.6, 'circle-radius': radius },
      });
      map.addLayer({
        id: 'status',
        type: 'circle',
        source: 'status',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': ['match', ['get', 'cat'], 1, CAT_BY_N[1].color, 2, CAT_BY_N[2].color, 3, CAT_BY_N[3].color, 4, CAT_BY_N[4].color, 5, CAT_BY_N[5].color, 6, CAT_BY_N[6].color, '#999999'],
          'circle-opacity': 0.95,
          'circle-stroke-color': HALO,
          'circle-stroke-width': 0.5,
          'circle-radius': radius,
        },
      });

      map.fitBounds([[BBOX.minLon, BBOX.minLat], [BBOX.maxLon, BBOX.maxLat]], { padding: 24, duration: 0 });

      // Hover popups for both dot layers.
      const hover = (build) => (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (f) popup.setLngLat(f.geometry.coordinates).setHTML(build(f.properties)).addTo(map);
      };
      const leave = () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      };
      const monHtml = (p) => `<strong>${p.name}</strong><br/><span style="color:${INK}">${p.county} County, ${p.state}</span>`;
      const statHtml = (p) => `<strong>AQI ${p.aqi}</strong> — ${CAT_BY_N[p.cat]?.name ?? '—'}`;
      for (const [layer, build] of [['monitors', monHtml], ['status', statHtml]]) {
        map.on('mouseenter', layer, hover(build));
        map.on('mousemove', layer, hover(build));
        map.on('mouseleave', layer, leave);
      }
      // Size to the container now that it's laid out, and force the first paint.
      // (On mobile the map can init before the container has its final size,
      // which otherwise leaves the tiles blank until you interact with it.)
      map.resize();
      map.triggerRepaint();
      setReady(true);
    });

    // Keep the canvas matched to its container whenever that size changes —
    // orientation flips, the mobile address bar collapsing, fonts settling, etc.
    // This is the standard fix for a MapLibre map that renders blank on mobile.
    const ro = new ResizeObserver(() => {
      map.resize();
      map.triggerRepaint();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  // ── layer visibility follows the mode ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('coverage', mode === 'coverage');
    vis('monitors', mode === 'locations');
    vis('status', mode === 'status');
  }, [mode, ready]);

  // ── Live AQI: PREFETCH on mount (not on tab-open) so opening the tab shows
  // coloured dots immediately, with no awkward gap while the fetch lands.
  // Sites are filtered to US points — AirNow's border BBOX returns some
  // Canadian/Mexican monitors we don't want on a US map. ──────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/monitor-status'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((j) => {
        if (cancelled) return;
        const sites = (j.sites ?? []).filter(([lat, lon]) => pointInUS(lon, lat));
        setStatusGeo({
          type: 'FeatureCollection',
          features: sites.map(([lat, lon, aqi, cat]) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { aqi, cat },
          })),
        });
        const counts = {};
        for (const [, , , cat] of sites) counts[cat] = (counts[cat] ?? 0) + 1;
        setStatusMeta({ counts, observedAt: j.observedAt, total: sites.length });
      })
      .catch(() => {
        if (!cancelled) {
          setStatusGeo(EMPTY);
          setStatusMeta({ error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && statusGeo) {
      map.getSource('status')?.setData(statusGeo);
      map.triggerRepaint(); // ensure the new dots paint even if the map is idle
    }
  }, [statusGeo, ready]);

  // ── Coverage: compute the grid the first time that mode is opened ────────────
  useEffect(() => {
    if (mode !== 'coverage' || coverageGeo) return undefined;
    // Defer a tick so the button state paints before the (~150ms) compute.
    const t = setTimeout(() => setCoverageGeo(buildCoverageGrid(0.5)), 0);
    return () => clearTimeout(t);
  }, [mode, coverageGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && coverageGeo) {
      map.getSource('coverage')?.setData(coverageGeo);
      map.triggerRepaint();
    }
  }, [coverageGeo, ready]);

  // ── category filter (Live AQI) ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer('status')) return;
    const visible = CATS.filter((c) => !hidden.has(c.n)).map((c) => c.n);
    map.setFilter('status', ['in', ['get', 'cat'], ['literal', visible]]);
  }, [hidden, ready]);

  const toggleCat = (n) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  const pct = Math.round((648 / 3144) * 100);
  // Live-AQI dots are prefetched on mount; show a loading veil only if the tab
  // is open before that fetch has landed (and it isn't an outright failure).
  const statusLoading = mode === 'status' && !statusGeo && !statusMeta?.error;

  return (
    <div>
      <p className="mb-5 mt-1 max-w-prose text-ink-muted">
        Every dot is an active regulatory PM2.5 monitor. The green “Good” badge on your phone is
        usually a <strong>model</strong> interpolated between these dots — so the wider the gap, the
        more your air is a guess. Zoom in to find the nearest one to you.
      </p>

      <GourmetMediaContainer
        title="The monitor gap: every regulatory PM2.5 monitor in the contiguous US"
        controls={<ModeToggle mode={mode} onMode={setMode} />}
        source={SOURCE}
      >
        <div className="w-full">
          <div className="relative">
            <div
              ref={containerRef}
              className="h-[560px] w-full overflow-hidden rounded-lg border border-grid-strong bg-cream"
              role="img"
              aria-label={`Map of ${shownCount} regulatory PM2.5 monitors across the contiguous United States`}
            />
            {statusLoading && <MapLoadingVeil label="Loading live monitor readings…" />}
          </div>

          {mode === 'status' ? (
            <StatusLegend hidden={hidden} onToggle={toggleCat} meta={statusMeta} />
          ) : mode === 'coverage' ? (
            <CoverageLegend ready={!!coverageGeo} />
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              <strong className="text-ink">{shownCount.toLocaleString()}</strong> active monitors
              shown ({total.toLocaleString()} nationwide, incl. Alaska &amp; Hawaii). By our compile,
              only <strong className="text-ink">648 of ~3,144 US counties (≈{pct}%)</strong> have one
              at all — everywhere else, the AQI you see is stretched across the empty space between
              dots.
            </p>
          )}
        </div>
      </GourmetMediaContainer>
    </div>
  );
}

/* ── MapLoadingVeil: a translucent overlay + spinner shown over the map while
   the live-AQI readings are still loading, so the tab never flashes an empty
   (uncoloured) map. Absolutely positioned inside the map's relative wrapper. ── */
function MapLoadingVeil({ label }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-ground-lift/70 backdrop-blur-[1px]">
      <span
        className="h-7 w-7 animate-spin rounded-full border-2 border-grid-strong border-t-ink-bright"
        aria-hidden
      />
      <span className="label-caps !text-ink-bright">{label}</span>
    </div>
  );
}

/* ── ModeToggle: which layer the map shows ──────────────────────────────────── */
function ModeToggle({ mode, onMode }) {
  const opts = [
    { value: 'locations', label: 'Locations' },
    { value: 'status', label: 'Live AQI' },
    { value: 'coverage', label: 'Coverage gaps' },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Show</span>
      <div className="inline-flex flex-wrap gap-2">
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onMode(o.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              mode === o.value ? '!bg-ink !text-cream' : 'text-ink-muted hover:!text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── StatusLegend: category chips that double as show/hide filters ──────────── */
function StatusLegend({ hidden, onToggle, meta }) {
  if (meta?.error) {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        Live status is unavailable right now (the AirNow feed didn’t respond). Try “Locations” or
        “Coverage gaps.”
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-sm text-ink-muted">
        Each monitor’s <strong className="text-ink">current</strong> AQI category
        {meta?.observedAt ? ` (as of ${meta.observedAt})` : ' — loading…'}. Tap a category to
        show/hide it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CATS.map((c) => {
          const off = hidden.has(c.n);
          const count = meta?.counts?.[c.n] ?? 0;
          return (
            <button
              key={c.n}
              type="button"
              onClick={() => onToggle(c.n)}
              aria-pressed={!off}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity ${
                off ? 'border-grid-strong opacity-40' : 'border-ink'
              }`}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              <span className={off ? 'line-through' : ''}>{c.name}</span>
              <span className="font-semibold tabular-nums text-ink-muted">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── CoverageLegend: the distance bands + what a blank area means ───────────── */
function CoverageLegend({ ready }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-sm text-ink-muted">
        {ready ? (
          <>
            Land shaded by distance to the <strong className="text-ink">nearest</strong> monitor. The
            <strong className="text-ink"> deep-red</strong> land is{' '}
            <strong className="text-ink">more than 150 miles</strong> from one — those are the gaps
            your AQI is interpolated across.
          </>
        ) : (
          <>Computing coverage…</>
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        {[...COVERAGE_BANDS, COVERAGE_GAP].map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5 text-xs text-ink">
            <span className="h-3 w-3 rounded-sm" style={{ background: b.color, opacity: 0.85 }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
