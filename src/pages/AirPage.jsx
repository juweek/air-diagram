import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { getByQuery } from '../data/airQuality';
import { POLLUTANTS, aqiCategory } from '../lib/pollutants';
import { SOURCES, ULTRAFINE, particleBreakdown } from '../lib/composition';
import { SCENARIOS } from '../data/scenarios';
import LookupInput from '../components/LookupInput';
import GourmetMediaContainer from '../components/GourmetMediaContainer';
import { Loading, ErrorState } from '../components/Status';
import P5Sketch from '../viz/P5Sketch';
import { airParticleSketch } from '../viz/airParticleSketch';

// Open-Meteo serves CAMS *model* output on an ~11 km grid — an estimate, not a
// monitor reading. The label says so: the tool must not commit the sin the
// piece critiques (a modeled number dressed up as a measurement).
const SOURCE_LABEL = 'Open-Meteo Air Quality API (CAMS model, ~11 km grid)';
const SOURCE_BASE = 'https://open-meteo.com/en/docs/air-quality-api';

// The source link points at the API docs. Once we know the place, we deep-link
// to the exact coordinates we queried so "Source" reproduces this reading.
function sourceFor(location) {
  // Scenarios carry their own `source` (handled by the caller) and have no
  // coordinates, so only deep-link when we have real numbers.
  if (typeof location?.latitude !== 'number') return { label: SOURCE_LABEL, url: SOURCE_BASE };
  const lat = location.latitude.toFixed(3);
  const lon = location.longitude.toFixed(3);
  return { label: SOURCE_LABEL, url: `${SOURCE_BASE}?latitude=${lat}&longitude=${lon}` };
}

// The full US EPA AQI scale (0–500) as a segmented bar. Spans are the AQI range
// each band covers; colors match aqiCategory() in pollutants.js — including the
// maroon "Hazardous" top so the worst-case scenarios read correctly.
const AQI_MAX = 500;
const AQI_BANDS = [
  { name: 'Good', color: '#3B9C46', span: 50 },
  { name: 'Moderate', color: '#C7A70A', span: 50 },
  { name: 'Sensitive', color: '#E07C00', span: 50 },
  { name: 'Unhealthy', color: '#D6392F', span: 50 },
  { name: 'Very unhealthy', color: '#8F3F97', span: 100 },
  { name: 'Hazardous', color: '#7E0023', span: 200 },
];

/**
 * THE TOOL PAGE. Wiring:  route param (/:query) → useAsync(getByQuery, query)
 * → the p5 diagram + readouts. The lookup key lives in the URL, so every result
 * is a shareable/embeddable address (/Detroit, /90001). view/mode are local
 * state, NOT part of the fetch key, so toggling them never refetches.
 */
export default function AirPage() {
  const { query: rawQuery } = useParams();
  const query = rawQuery ? decodeURIComponent(rawQuery) : '';
  const navigate = useNavigate();
  const state = useAsync(getByQuery, query);

  const [view, setView] = useState('source'); // 'source' | 'rings'
  const [mode, setMode] = useState('legal'); // 'legal' | 'who'
  // Source keys the viewer has switched off in the "what's in a breath" list;
  // hidden specks are dropped from the diagram too. Immutable array so the
  // sketch memo below sees a new reference and remounts on every toggle.
  const [hidden, setHidden] = useState([]);
  const toggleSource = (key) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const hasResult = state.status === 'done';
  const current = hasResult ? state.data.current : null;

  // Stable objects so each P5Sketch only remounts on a real data change.
  // The source/baseline view uses one canvas (sketchData); the pollutant view
  // uses two — the same rings measured against the WHO line and the legal line
  // side by side — so it gets its own pair of memoized data objects.
  const sketchData = useMemo(
    () => ({ current, view: hasResult ? view : 'baseline', mode, hidden }),
    [current, hasResult, view, mode, hidden]
  );
  const ringsWho = useMemo(() => ({ current, view: 'rings', mode: 'who' }), [current]);
  const ringsLegal = useMemo(() => ({ current, view: 'rings', mode: 'legal' }), [current]);
  const showRings = hasResult && view === 'rings';

  // One source line, reused by the container footer AND the by-source readout
  // section. Scenarios carry their own; places deep-link to their coordinates.
  const source = hasResult ? (state.data.source ?? sourceFor(state.data.location)) : sourceFor(null);

  return (
    <div>
      {/* ── Editorial hero. The glitch texture bleeds from the top edge and
         fades into the ground (Style-2 "1c"); the italic serif headline sits
         over it, then the thesis, search and scenario links. ────────────── */}
      <section className="relative -mt-2 mb-8 pt-6">
        <div className="glitch-texture" aria-hidden />
        <div className="relative">
          <p className="label-caps mb-4">— A brief reckoning —</p>
          <h2 className="font-display text-4xl italic leading-[1.05] text-ink-bright sm:text-6xl">
            What’s actually
            <br />
            in the air.
          </h2>
          <p className="mb-6 mt-5 max-w-prose font-display text-lg leading-relaxed text-ink-muted">
            The green “Good” badge hides two things: a legal line that’s far looser than the health
            line, and what’s actually in a breath. Search a place to see its air drawn particle by
            particle.
          </p>

          <LookupInput defaultValue={query} onSubmit={(q) => navigate(`/${encodeURIComponent(q)}`)} />

          <ScenarioBar active={query.toLowerCase()} onPick={(id) => navigate(`/${id}`)} />
        </div>
      </section>

      {state.status === 'loading' && <Loading label={`Looking up ${query}…`} />}
      {state.status === 'error' && <ErrorState message={state.error} />}

      <div className="mt-6">
        <GourmetMediaContainer
          title={hasResult ? `What’s in the air in ${state.data.location.name}?` : 'What’s in the air?'}
          controls={hasResult ? <Controls view={view} mode={mode} onView={setView} onMode={setMode} /> : null}
          source={source}
        >
          <div className="flex flex-wrap items-start justify-center gap-6 text-left">
            {showRings ? (
              // Two ring canvases stacked vertically inside one cream panel — the
              // shared background makes them read as a single split canvas.
              <div className="w-full max-w-[560px] flex-1 basis-[420px]">
                <div className="mx-auto max-w-[360px] rounded-lg bg-cream p-2">
                  <RingPanel label="WHO health line" data={ringsWho} />
                  <RingPanel label="US legal line" data={ringsLegal} />
                </div>
              </div>
            ) : (
              <div className="w-full max-w-[560px] flex-1 basis-[420px]">
                <P5Sketch sketch={airParticleSketch} data={sketchData} />
                {hasResult && view === 'source' && (
                  <p className="label-caps mt-2 text-center">
                    drag to orbit · scroll or pinch to zoom
                  </p>
                )}
              </div>
            )}
            <aside className="w-full flex-1 basis-[260px]">
              {hasResult ? (
                <Readout
                  result={state.data}
                  view={view}
                  mode={mode}
                  hidden={hidden}
                  onToggle={toggleSource}
                  source={source}
                />
              ) : (
                <BaselineNote />
              )}
            </aside>
          </div>
        </GourmetMediaContainer>
      </div>
    </div>
  );
}

/* ── ScenarioBar: quick presets to compare against a cigarette, wildfire, etc.
   Each just navigates to /:id — the scenario is a real, shareable address. ── */
function ScenarioBar({ active, onPick }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="label-caps">Or a scenario</span>
      {SCENARIOS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          className={`label-caps border-b pb-0.5 transition-colors ${
            active === s.id ? '!text-ink-bright border-current' : 'border-transparent hover:!text-ink'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* ── RingPanel: one labeled pollutant-ring canvas. Two stack vertically inside
   a shared cream panel (WHO above, legal below) so the two reference lines read
   against each other on the same apparent canvas. ─────────────────────────── */
function RingPanel({ label, data }) {
  return (
    <div>
      <div className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <P5Sketch sketch={airParticleSketch} data={data} />
    </div>
  );
}

/* ── Controls: the segmented pill toggles ─────────────────────────────────────
   "Measured against" only appears in the source view — the by-pollutant view
   now shows BOTH lines side by side, so it has nothing to toggle. */
function Controls({ view, mode, onView, onMode }) {
  return (
    <div className="flex flex-wrap gap-6">
      <Segmented
        label="View"
        value={view}
        onChange={onView}
        options={[
          { value: 'source', label: 'By source' },
          { value: 'rings', label: 'By pollutant' },
        ]}
      />
      {view === 'source' && (
        <Segmented
          label="Measured against"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'legal', label: 'US legal line' },
            { value: 'who', label: 'WHO health line' },
          ]}
        />
      )}
    </div>
  );
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {/* No wrapping border here — each option already carries its own pill
          border (from the .buttonsDiv button convention in index.css). */}
      <div className="inline-flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              value === opt.value ? '!bg-ink !text-cream' : 'text-ink-muted hover:!text-ink'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Readout: AQI headline + per-view legend. Capped height with its own scroll
   so a long list never runs past the diagram beside it. ───────────────────── */
// The AQI is a MAXIMUM across pollutants, not a summary — so the headline is
// the worst of the per-pollutant AQIs (or our PM2.5 NowCast, whichever is
// higher), and we name the pollutant driving it. Taking only the PM2.5 NowCast
// used to under-read high-ozone days.
const AQI_DRIVERS = [
  { key: 'us_aqi_pm2_5', label: 'PM2.5' },
  { key: 'us_aqi_pm10', label: 'PM10' },
  { key: 'us_aqi_ozone', label: 'ozone' },
  { key: 'us_aqi_nitrogen_dioxide', label: 'NO₂' },
  { key: 'us_aqi_sulphur_dioxide', label: 'SO₂' },
  { key: 'us_aqi_carbon_monoxide', label: 'CO' },
];

function headlineAqi(current, nowcast) {
  let aqi = current.us_aqi ?? null;
  let driver = null;
  for (const d of AQI_DRIVERS) {
    const v = current[d.key];
    if (v != null && (aqi == null || v >= aqi)) {
      aqi = Math.max(aqi ?? 0, v);
      driver = d.label;
    }
  }
  if (nowcast?.aqi != null && (aqi == null || nowcast.aqi > aqi)) {
    aqi = nowcast.aqi;
    driver = 'PM2.5';
  }
  return { aqi, driver };
}

// AirNow parameter names → tidy display labels. Also used to line the measured
// driver up with the modeled driver naming (ozone, not O3).
const MEASURED_LABELS = { 'PM2.5': 'PM2.5', O3: 'O₃', PM10: 'PM10' };
const measuredDriverName = (d) => (d === 'O3' ? 'ozone' : d);

/* ── MeasuredVsModeled: when a real AirNow reading exists near the search, the
   headline IS that measurement; this shows its per-pollutant AQIs and, beside
   them, what the CAMS model (what most apps show) says — so the gap is visible.
   The particle makeup below stays modeled (AirNow gives AQI, not the mix). ── */
function MeasuredVsModeled({ measured, modeled }) {
  const keys = ['PM2.5', 'O3', 'PM10'].filter((k) => measured.parameters[k]);
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11px] leading-snug text-ink">
        <span className="mr-1 rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream">
          Measured
        </span>
        Real reading from the <strong>{measured.reportingArea}</strong> reporting area
        {measured.distanceMi != null && <> ({measured.distanceMi} mi away)</>}, {measured.observedAt}
        . The headline above is this monitor data — not a model.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {keys.map((k) => {
          const p = measured.parameters[k];
          const isDriver = k === measured.driver;
          const cat = aqiCategory(p.aqi);
          return (
            <span
              key={k}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                isDriver ? 'border-ink bg-ink font-semibold text-cream' : 'border-grid-strong text-ink'
              }`}
            >
              {MEASURED_LABELS[k]}
              <span
                className="font-bold tabular-nums"
                style={isDriver ? undefined : { color: cat.color }}
              >
                {p.aqi}
              </span>
            </span>
          );
        })}
      </div>
      <p className="text-[11px] leading-snug text-ink-muted">
        {modeled?.aqi != null ? (
          <>
            For comparison, the <strong>CAMS model</strong> (what most phone apps interpolate) reads{' '}
            <strong>{modeled.aqi}</strong>
            {modeled.driver ? ` (${modeled.driver})` : ''} here — the particle makeup below is
            modeled from it.
          </>
        ) : (
          <>The particle makeup below is modeled (live model data is unavailable right now).</>
        )}
      </p>
    </div>
  );
}

function Readout({ result, view, mode, hidden, onToggle, source }) {
  const { location, current, nowcast, monitor } = result;
  const modeled = headlineAqi(current, nowcast);
  // A real AirNow reading, when one exists near the search, becomes the headline
  // and demotes the CAMS model to a comparison — the measured/modeled gap is the
  // whole point of the piece.
  const measured = result.measured?.available ? result.measured : null;
  const displayAqi = measured ? measured.aqi : modeled.aqi;
  const category = aqiCategory(displayAqi);

  return (
    // The cap tracks the diagram beside it: the pollutant view stacks two ring
    // canvases (~2× as tall as the single source canvas), so its readout gets
    // more room before scrolling. Fixed px, not vh — see the preview quirk in
    // CLAUDE.md.
    <div
      className={`${
        view === 'rings' ? 'max-h-[820px]' : 'max-h-[560px]'
      } overflow-y-auto rounded-lg border border-grid-strong bg-cream/60 p-5`}
    >
      <h3 className="font-display text-2xl italic">{location.name}</h3>

      <AqiMeter aqi={displayAqi} category={category} />
      {measured ? (
        <MeasuredVsModeled measured={measured} modeled={result.fallback ? null : modeled} />
      ) : result.fallback ? (
        <p className="mb-3 rounded-lg border border-dashed border-data-accent bg-data-accent/10 px-3 py-2 text-xs leading-relaxed text-ink">
          <strong>Live data is unavailable right now.</strong> This is the{' '}
          <strong>typical annual average</strong> PM2.5 from the nearest EPA monitor (
          {result.fallback.distanceMi} mi away, 2024) — a stand-in for the usual air here, not
          today’s reading.
        </p>
      ) : (
        <p className="mb-2 text-xs leading-relaxed text-ink-muted">
          {result.blurb ? (
            result.blurb
          ) : (
            <>
              {modeled.driver && (
                <>
                  Today’s driver: <strong>{modeled.driver}</strong>
                  {nowcast?.aqi != null &&
                    ` · NowCast PM2.5 ${nowcast.concentration.toFixed(1)} µg/m³ (12-hr weighted)`}
                  .{' '}
                </>
              )}
              This reading is a <strong>modeled estimate</strong> (CAMS atmospheric model, ~11 km
              grid) — not a monitor reading.
            </>
          )}
        </p>
      )}
      {!result.blurb && !result.fallback && !measured && (
        <SubIndexStrip current={current} driver={modeled.driver} nowcast={nowcast} />
      )}
      {monitor && (
        <p className="mb-4 rounded-lg border border-dashed border-grid-strong bg-cream/60 px-3 py-2 text-xs leading-relaxed text-ink">
          Nearest regulatory PM2.5 monitor: <strong>{monitor.distanceMi} mi</strong> away —{' '}
          {monitor.name} ({monitor.county} County, {monitor.state}). Your number is a model
          stretched over that gap. Only ~1 in 5 US counties has one at all.
        </p>
      )}

      {view === 'source' ? (
        <SourceLegend current={current} mode={mode} hidden={hidden} onToggle={onToggle} source={source} />
      ) : (
        <PollutantList current={current} />
      )}
    </div>
  );
}

/* ── AqiMeter: an odometer-style half-gauge. The AQI (0–500) is a needle angle
   sweeping across the six EPA category bands, so the reading is read as a
   position on the danger arc — not just a number. The gauge is honest-linear
   (value ∝ angle over 0–500), matching the old bar; the reading + category name
   sit above it. ─────────────────────────────────────────────────────────── */
const GAUGE = { cx: 120, cy: 118, r: 92, sw: 15 };

// value (0–500) → needle angle: π (left) at 0 → 0 (right) at 500.
function gaugeAngle(value) {
  const f = Math.min(Math.max(value ?? 0, 0), AQI_MAX) / AQI_MAX;
  return Math.PI * (1 - f);
}
function gaugePoint(r, angle) {
  return [GAUGE.cx + r * Math.cos(angle), GAUGE.cy - r * Math.sin(angle)];
}
// A colored arc segment spanning the AQI range [v0, v1] on the band circle.
function gaugeArc(v0, v1) {
  const [x0, y0] = gaugePoint(GAUGE.r, gaugeAngle(v0));
  const [x1, y1] = gaugePoint(GAUGE.r, gaugeAngle(v1));
  // Angle decreases as value rises, so the sweep is clockwise (flag 1); no band
  // spans more than 180°, so large-arc is always 0.
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${GAUGE.r} ${GAUGE.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function AqiMeter({ aqi, category }) {
  // Turn the band spans into cumulative [v0, v1] AQI ranges to draw each arc.
  let cursor = 0;
  const bands = AQI_BANDS.map((b) => {
    const seg = { ...b, v0: cursor, v1: cursor + b.span };
    cursor += b.span;
    return seg;
  });
  const [nx, ny] = gaugePoint(GAUGE.r - GAUGE.sw / 2 - 4, gaugeAngle(aqi ?? 0));

  return (
    <div className="mb-3 mt-3">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-3xl font-black" style={{ color: category.color }}>
          {aqi ?? '—'}
        </span>
        <span className="font-semibold text-ink">{category.name}</span>
      </div>
      <svg
        viewBox="0 0 240 140"
        className="w-full max-w-[260px]"
        role="img"
        aria-label={`Air Quality Index ${aqi ?? 'unknown'} out of 500 — ${category.name}`}
      >
        {bands.map((b) => (
          <path
            key={b.name}
            d={gaugeArc(b.v0, b.v1)}
            fill="none"
            stroke={b.color}
            strokeWidth={GAUGE.sw}
            opacity={aqi == null ? 0.35 : 1}
          />
        ))}
        {aqi != null && (
          <>
            <line
              x1={GAUGE.cx}
              y1={GAUGE.cy}
              x2={nx.toFixed(2)}
              y2={ny.toFixed(2)}
              stroke="#f6efe0"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx={GAUGE.cx} cy={GAUGE.cy} r="5.5" fill="#f6efe0" />
          </>
        )}
        <text x={GAUGE.cx - GAUGE.r} y={GAUGE.cy + 16} textAnchor="middle" fontSize="9" fill="#a8987e">
          0
        </text>
        <text x={GAUGE.cx + GAUGE.r} y={GAUGE.cy + 16} textAnchor="middle" fontSize="9" fill="#a8987e">
          500
        </text>
      </svg>
    </div>
  );
}

/* ── SubIndexStrip: the AQI is the WORST of six per-pollutant sub-scores, never
   an average. Showing all six at once makes "today's driver" self-explanatory —
   the headline is just the biggest chip. Only renders when the per-pollutant
   AQIs exist (live lookups); scenarios carry a single AQI and skip it. ────── */
function SubIndexStrip({ current, driver, nowcast }) {
  const items = AQI_DRIVERS.map((d) => {
    let aqi = current[d.key];
    // The headline uses our 12-hr NowCast for PM2.5 (steadier than the API's
    // single-hour us_aqi_pm2_5), so surface the SAME number here — otherwise the
    // highlighted driver chip can disagree with the big headline above it.
    if (d.key === 'us_aqi_pm2_5' && nowcast?.aqi != null) aqi = Math.max(aqi ?? 0, nowcast.aqi);
    return { ...d, aqi };
  }).filter((d) => d.aqi != null);
  if (items.length < 2) return null;
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[11px] leading-snug text-ink-muted">
        The headline is the <strong>worst</strong> of six separate pollutant scores — not an average.
        All six right now:
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map((d) => {
          const isDriver = d.label === driver;
          const cat = aqiCategory(d.aqi);
          return (
            <span
              key={d.key}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                isDriver ? 'border-ink bg-ink font-semibold text-cream' : 'border-grid-strong text-ink'
              }`}
            >
              {d.label}
              <span
                className="font-bold tabular-nums"
                style={isDriver ? undefined : { color: cat.color }}
              >
                {d.aqi}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SourceLegend({ current, mode, hidden, onToggle, source }) {
  const breakdown = particleBreakdown(current, mode);
  // The five regulated sources make up the "official" breath, so their shares
  // sum to 100%. Ultrafine sits OUTSIDE that 100% — it's never in the mass
  // number — so it gets its own row with a raw count, not a percent.
  // Sources that round to 0% are dropped — they aren't really in this air.
  const sources = SOURCES.map((s) => ({
    ...s,
    pct: Math.round((breakdown.fractions[s.key] ?? 0) * 100),
  })).filter((s) => s.pct > 0);
  const lineLabel = mode === 'who' ? 'WHO health line (5 µg/m³)' : 'US legal line (9 µg/m³)';

  // The source split is modeled from the OTHER pollutants (NO₂, SO₂, dust…). The
  // typical-annual fallback carries only a PM2.5 mass, so there's nothing to
  // apportion — say so plainly instead of drawing an empty list.
  if (sources.length === 0 && breakdown.ultrafine === 0) {
    return (
      <div>
        <h4 className="mb-1 font-subtitle text-base">What’s in this breath</h4>
        <p className="text-xs leading-relaxed text-ink-muted">
          The source breakdown needs the live pollutant mix (NO₂, SO₂, dust…), which isn’t available
          right now. Switch to <strong>By pollutant</strong> to see the PM2.5 mass we do have.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-1 font-subtitle text-base">What’s in this breath</h4>
      <p className="mb-2 text-xs leading-relaxed text-ink-muted">
        By volume a breath is ~78% nitrogen, ~21% oxygen and ~1% argon — that’s{' '}
        <strong>99.9%+</strong> of every breath. Everything below is the leftover sliver of
        pollution (well under 0.01% of the air), zoomed in and split by source. Tap a row to remove
        it.
      </p>
      <p className="mb-2 rounded-md bg-cream/60 px-2 py-1.5 text-[11px] leading-snug text-ink-muted">
        These buckets are the <strong>modeled</strong> makeup of the fine-particle (PM2.5){' '}
        <em>mass</em> — what the particles likely are, not the gases. “Sulfate &amp; nitrate haze,”
        for instance, is the <em>particle</em> that forms when SO₂ and NO₂ <em>gases</em> react in
        the air; those gases themselves are measured in the <strong>By pollutant</strong> view.
      </p>
      {/* Percentages only — the raw speck counts are rendering density (they
          change with screen size), so quoting them as data was false precision. */}
      <ul className="grid gap-0.5">
        {sources.map((e) => (
          <LegendRow key={e.key} entry={e} off={hidden.includes(e.key)} onToggle={onToggle}>
            <span className="tabular-nums">{e.pct}%</span>
          </LegendRow>
        ))}
        {breakdown.ultrafine > 0 && (
          <li className="mt-1 border-t border-dashed border-grid-strong pt-1.5">
            <LegendRow
              entry={{ ...ULTRAFINE, label: 'Ultrafine — never counted' }}
              off={hidden.includes(ULTRAFINE.key)}
              onToggle={onToggle}
              rose
            >
              <span className="text-xs">modeled swarm</span>
            </LegendRow>
          </li>
        )}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Percentages are the share of the modeled particle mass (from the regulated pollutants, not
        directly measured), scaled against the <strong>{lineLabel}</strong>.{' '}
        <strong>Ultrafine</strong> is extra: particles so small they never enter the official mass
        number, so they don’t count toward the 100% above — the swarm drawn is a modeled intensity,
        not a count.
      </p>
      {source && (
        <p className="mt-2 text-xs text-ink-muted">
          Source:{' '}
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-data-primary underline"
          >
            {source.label}
          </a>
        </p>
      )}
    </div>
  );
}

// One tappable legend row: checkbox + color dot + label + value (children).
function LegendRow({ entry, off, onToggle, rose, children }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(entry.key)}
      aria-pressed={!off}
      className={`grid w-full grid-cols-[14px_12px_1fr_auto] items-center gap-2 rounded py-0.5 text-left text-sm transition-colors hover:bg-ink/10 ${
        off ? 'opacity-40' : ''
      } ${rose ? 'text-rose' : ''}`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] leading-none ${
          off ? 'border-grid-strong text-transparent' : 'border-ink bg-ink text-cream'
        }`}
      >
        ✓
      </span>
      <span className="h-3 w-3 rounded-full" style={{ background: entry.color }} />
      <span className={off ? 'line-through' : ''}>{entry.label}</span>
      <span className="font-semibold">{children}</span>
    </button>
  );
}

function PollutantList({ current }) {
  return (
    <div>
      <h4 className="mb-1 font-subtitle text-base">Each reading vs both lines</h4>
      <p className="mb-2 rounded-md bg-cream/60 px-2 py-1.5 text-[11px] leading-snug text-ink-muted">
        These are the six pollutants regulators <strong>measure directly</strong> — each a real
        concentration (SO₂ here is the <em>gas</em>). Contrast with <strong>By source</strong>,
        which <em>models</em> what the PM2.5 particle mass is made of.
      </p>
      <p className="mb-2 text-xs text-ink-muted">
        How many times over the health line (WHO) and the looser legal line (US) each pollutant
        sits. A full bar means it’s at or past that line. The lines use different averaging periods
        (annual, 24-hr, hourly) — read the bars as scale, not a compliance ruling.
      </p>
      <ul className="grid gap-2.5">
        {POLLUTANTS.map((def) => {
          const value = current[def.key];
          if (value == null) return null;
          // Same hex the ring diagram draws with — the dot, bars and ring all
          // cross-reference by colour.
          const hex = def.color;
          return (
            <li key={def.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} />
                  <span className="truncate">
                    <strong>{def.label}</strong>{' '}
                    <span className="text-xs text-ink-muted">{def.name}</span>
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-muted">
                  {value} {def.unit}
                </span>
              </div>
              <div className="mt-1 grid gap-1">
                <MiniLine label="WHO" ratio={value / def.who} color={hex} />
                <MiniLine label="US legal" ratio={value / def.legal} color={hex} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A single "reading ÷ reference line" bar. Fills toward the line; a full bar
// plus the multiple at right means the reading is at or past it. The bar keeps
// the pollutant's own colour so it cross-references the ring diagram directly.
function MiniLine({ label, ratio, color }) {
  const pct = Math.min(ratio, 1) * 100;
  const text = ratio >= 0.1 ? `${ratio.toFixed(1)}×` : '<0.1×';
  return (
    <div className="grid grid-cols-[3.5rem_1fr_2.2rem] items-center gap-1.5 text-[10px] leading-tight">
      <span className="uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="block h-1.5 min-w-0 overflow-hidden rounded-full bg-grid-medium">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-right font-semibold tabular-nums">{text}</span>
    </div>
  );
}

function BaselineNote() {
  return (
    <div className="rounded-lg border border-grid-strong bg-cream/60 p-5">
      <h3 className="font-display text-2xl italic">Baseline: Earth’s atmosphere</h3>
      <p className="mt-2 leading-relaxed text-ink-muted">
        Right now you’re looking at clean air by composition — nitrogen, oxygen, argon, CO₂, neon,
        and trace gases. Search a place above and the diagram redraws using its current pollutant
        levels instead.
      </p>
    </div>
  );
}
