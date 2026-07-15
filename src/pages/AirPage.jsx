import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { getByQuery } from '../data/airQuality';
import { POLLUTANTS, aqiCategory, POLLUTANT_BLURBS } from '../lib/pollutants';
import { pm25Aqi } from '../lib/nowcast';
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
// When a real AirNow reading drives the headline, AirNow leads the credit —
// the model is then only behind the particle makeup, and the label says so.
function sourceFor(location, measured = false) {
  if (measured) {
    return {
      label: 'AirNow (US EPA) — measured AQI · particle makeup modeled via Open-Meteo (CAMS)',
      url: 'https://www.airnow.gov/',
    };
  }
  // Scenarios carry their own `source` (handled by the caller) and have no
  // coordinates, so only deep-link when we have real numbers.
  if (typeof location?.latitude !== 'number') return { label: SOURCE_LABEL, url: SOURCE_BASE };
  const lat = location.latitude.toFixed(3);
  const lon = location.longitude.toFixed(3);
  return { label: SOURCE_LABEL, url: `${SOURCE_BASE}?latitude=${lat}&longitude=${lon}` };
}

// Places the "Try someplace new" button can land on — a deliberate mix of
// clean, smoggy, smoky and dusty US air so the roll teaches the range. A
// static list keeps it instant (the only cost is the normal lookup the
// navigation triggers, and useAsync caches repeats).
const RANDOM_PLACES = [
  'Detroit', 'Phoenix', 'Fresno', 'Bakersfield', 'Visalia', 'Los Angeles', '90001',
  'Pittsburgh', 'Houston', 'Denver', 'Salt Lake City', 'Boise', 'Missoula', 'Spokane',
  'Chicago', 'Seattle', 'Portland', 'Albuquerque', 'El Paso', 'Las Vegas', 'Reno',
  'Fairbanks', 'Anchorage', 'Honolulu', 'Miami', 'Atlanta', 'Minneapolis', 'St. Louis',
  'New Orleans', 'New York',
];
function randomPlace(exclude) {
  let pick;
  do {
    pick = RANDOM_PLACES[Math.floor(Math.random() * RANDOM_PLACES.length)];
  } while (pick.toLowerCase() === exclude && RANDOM_PLACES.length > 1);
  return pick;
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
  // Source keys the viewer has switched off in the "what's in a breath" list;
  // hidden specks are dropped from the diagram too. Immutable array so the
  // sketch memo below sees a new reference and remounts on every toggle.
  const [hidden, setHidden] = useState([]);
  const toggleSource = (key) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const hasResult = state.status === 'done';
  const current = hasResult ? state.data.current : null;

  // Stable objects so each P5Sketch only remounts on a real data change.
  // Source/baseline: one canvas. By-pollutant: a single ring canvas for today’s
  // reading (hover names each ring). Source field always scales against legal.
  const sketchData = useMemo(
    () => ({ current, view: hasResult ? view : 'baseline', mode: 'legal', hidden }),
    [current, hasResult, view, hidden]
  );
  const ringsCurrent = useMemo(() => ({ current, view: 'rings', mode: 'current' }), [current]);
  const showRings = hasResult && view === 'rings';

  // One source line, reused by the container footer AND the by-source readout
  // section. Scenarios carry their own; places deep-link to their coordinates —
  // and when a real AirNow reading is the headline, AirNow leads the credit.
  const source = hasResult
    ? (state.data.source ?? sourceFor(state.data.location, !!state.data.measured?.available))
    : sourceFor(null);

  return (
    <div>
      {/* ── Editorial hero, landing-page centered: eyebrow, headline, then a
         band of "bar chart" lines rising out of the charcoal (they fade from
         nothing at their tops into solid at the baseline), thesis, a large
         centered search, and the scenario / random-place links. ──────────── */}
      <section className="relative -mt-2 mb-8 pt-6 text-center">
        <h2 className="font-display text-4xl italic leading-[1.05] text-ink-bright sm:text-6xl">
          What’s actually
          <br />
          in the air.
        </h2>
        <p className="mx-auto mb-7 mt-6 max-w-prose font-display text-lg leading-relaxed text-ink-muted">
          The legal line for clean air is far looser than is actually healthy. Search a place to see
          its air quality, drawn particle by particle.
        </p>

        <HeroBars />

        {/* Search and "try someplace new" share one centered row. Extra top
           margin separates the skyline from the lookup so the bars can breathe. */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-end justify-center gap-x-5 gap-y-3 sm:mt-14">
          <div className="min-w-[240px] flex-1">
            <LookupInput
              large
              defaultValue={query}
              onSubmit={(q) => navigate(`/${encodeURIComponent(q)}`)}
            />
          </div>
          <button
            type="button"
            onClick={() => navigate(`/${encodeURIComponent(randomPlace(query.toLowerCase()))}`)}
            className="label-caps shrink-0 rounded-full border border-grid-strong px-4 py-2 !text-ink transition-colors hover:!border-ink hover:!text-ink-bright"
          >
            ↺ Random
          </button>
        </div>

        <ScenarioBar active={query.toLowerCase()} onPick={(id) => navigate(`/${id}`)} />
      </section>

      {state.status === 'loading' && <Loading label={`Looking up ${query}…`} />}
      {state.status === 'error' && <ErrorState message={state.error} />}

      <div className="mt-6">
        <GourmetMediaContainer
          title={hasResult ? `What’s in the air in ${state.data.location.name}?` : 'What’s in the air?'}
          controls={hasResult ? <Controls view={view} onView={setView} /> : null}
          source={source}
        >
          {hasResult && state.data.alert && <AlertBanner alert={state.data.alert} />}
          <div className="flex flex-wrap items-start justify-center gap-6 text-left">
            {showRings ? (
              <div className="w-full max-w-[560px] flex-1 basis-[420px]">
                <div className="mx-auto max-w-[400px] rounded-lg bg-cream p-2">
                  <RingPanel label="Today’s air" data={ringsCurrent} />
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

/* ── HeroBars: the hero's "bar chart rising out of the charcoal" band. A fixed
   pseudo-random skyline of thin bars whose TOPS fade to nothing (a vertical
   mask runs transparent→solid downward), so the lines emerge from the ground
   the way the readings emerge from the dark. Deterministic seed → the skyline
   is identical on every render (no re-randomizing, no layout shift). ──────── */
function HeroBars() {
  const bars = useMemo(() => {
    let seed = 41;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 120;
    return Array.from({ length: n }, (_, i) => ({
      x: (i / n) * 1200,
      w: (1200 / n) * 0.5,
      h: 14 + rand() * (rand() < 0.18 ? 128 : 78), // mostly short, a few spikes
    }));
  }, []);
  return (
    <svg
      viewBox="0 0 1200 150"
      preserveAspectRatio="none"
      className="mt-8 h-24 w-full sm:h-36"
      aria-hidden
    >
      <defs>
        {/* Mask: white = visible. Transparent at the top → each bar's tip
           dissolves into the charcoal; solid at the baseline. */}
        <linearGradient id="heroBarFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="heroBarMask">
          <rect width="1200" height="150" fill="url(#heroBarFade)" />
        </mask>
      </defs>
      <g mask="url(#heroBarMask)" className="hero-bars" fill="rgb(var(--sand))">
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={150 - b.h} width={b.w} height={b.h} rx="1" />
        ))}
      </g>
    </svg>
  );
}

/* ── ScenarioBar: quick presets to compare against a cigarette, wildfire, etc.,
   as a bordered dropdown. Picking one navigates to /:id — the scenario is a
   real, shareable address; the select resets to its "Try a scenario" prompt. ── */
function ScenarioBar({ active, onPick }) {
  const current = SCENARIOS.find((s) => s.id === active);
  return (
    <div className="mt-6 flex justify-center">
      <select
        value={current ? current.id : ''}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        aria-label="Try a scenario"
        className="label-caps cursor-pointer rounded-full border border-grid-strong bg-transparent px-4 py-2 !text-ink transition-colors hover:!border-ink focus:!border-ink focus:outline-none"
      >
        <option value="">Try a scenario…</option>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── RingPanel: one labeled pollutant-ring canvas for today’s reading.
   Density is scaled against a typical urban range (not WHO/legal), and hover
   still names each ring via the sketch’s in-canvas tooltip. ──────────────── */
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

/* ── Controls: the single "View" toggle. By-pollutant shows today’s reading as
   rings; the source field always renders against the legal line (the "Good"
   line the piece critiques). ─────────────────────────────────────────────── */
function Controls({ view, onView }) {
  return (
    <Segmented
      value={view}
      onChange={onView}
      options={[
        { value: 'source', label: 'By source' },
        { value: 'rings', label: 'By pollutant' },
      ]}
    />
  );
}

function Segmented({ value, onChange, options }) {
  return (
    // No wrapping border here — each option already carries its own pill border
    // (from the .buttonsDiv button convention in index.css).
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
  );
}

/* ── Tip: a small hover tooltip. Portaled to document.body with fixed coords so
   the readout’s overflow-y-auto can’t clip it. Hidden on touch (no hover) — the
   copy a tooltip carries must never be the ONLY place a fact lives. ───────── */
function Tip({ text, children }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const width = 240; // w-60
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom;
      const placeBelow = spaceBelow > 140 || r.top < 140;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setCoords({
        left,
        top: placeBelow ? r.bottom + gap : undefined,
        bottom: placeBelow ? undefined : window.innerHeight - r.top + gap,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  if (!text) return children;
  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-60 rounded-md border border-grid-strong bg-cream px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-ink shadow-xl"
            style={{ left: coords.left, top: coords.top, bottom: coords.bottom }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

/* ── Section: a titled readout block with a dividing rule above it. The title
   uses the same serif subtitle as "What's in this breath", so every block in
   the right-hand column reads as a distinct, self-contained section. ──────── */
function Section({ title, children }) {
  return (
    <section className="mt-4 border-t border-grid-strong pt-4">
      {title && <h4 className="mb-1.5 font-subtitle text-base">{title}</h4>}
      {children}
    </section>
  );
}

/* ── AlertBanner: an active NWS air alert for the searched point. Full-width
   strip at the top of the result card — the one place the tool borrows an
   OFFICIAL voice, so it's visually louder than anything modeled below it.
   Coverage caveat: these alerts are authored by state air agencies and only
   distributed by NWS, so silence here is not a clean bill of air. ─────────── */
function AlertBanner({ alert }) {
  const until =
    alert.until &&
    new Date(alert.until).toLocaleString([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-data-primary/60 bg-data-primary/10 px-4 py-2.5 text-left">
      <span className="label-caps !text-data-primary">⚠ NWS alert</span>
      <span className="text-sm font-semibold text-ink-bright">{alert.event}</span>
      {until && <span className="text-xs text-ink-muted">in effect until {until}</span>}
      {alert.sender && <span className="text-xs text-ink-muted">· {alert.sender}</span>}
      {alert.more > 0 && <span className="text-xs text-ink-muted">· +{alert.more} more</span>}
      <a
        href={alert.url}
        target="_blank"
        rel="noreferrer"
        className="ml-auto text-xs underline"
      >
        details
      </a>
    </div>
  );
}

/* ── ProvenanceBadge: says at a glance whether the headline number is a real
   monitor reading or an estimate — pinned top-right of the readout, above the
   gauge, so provenance is settled before the number is read. ──────────────── */
function ProvenanceBadge({ measured, fallback, scenario }) {
  const kind = measured
    ? {
        label: 'Measured',
        solid: true,
        tip: 'A real monitor reading (AirNow, US EPA) drives the headline number.',
      }
    : scenario
      ? {
          label: 'Illustrative',
          tip: 'A preset scenario built from typical published concentrations — not live data anywhere.',
        }
      : fallback
        ? {
            label: 'Typical annual',
            tip: 'Live data is unavailable — this is the nearest monitor’s 2024 annual average, not today’s air.',
          }
        : {
            label: 'Modeled',
            tip: 'No monitor reading nearby: this is the CAMS atmospheric model’s estimate (~11 km grid), interpolated to this point.',
          };
  return (
    <Tip text={kind.tip}>
      <span
        className={`label-caps shrink-0 cursor-help rounded-full border px-2.5 py-1 ${
          kind.solid
            ? 'border-ink bg-ink !text-cream'
            : 'border-dashed border-grid-strong !text-ink-muted'
        }`}
      >
        {kind.label}
      </span>
    </Tip>
  );
}

// 'YYYY-MM-DDTHH:MM' (local to the place — timezone=auto) → { hour: '8 PM',
// date: 'Jul 14' }. The series can cross a day boundary, so the trend labels
// and tooltip carry the date too.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function timeParts(time) {
  const h = parseInt(time.slice(11, 13), 10);
  const mo = parseInt(time.slice(5, 7), 10);
  const day = parseInt(time.slice(8, 10), 10);
  const hour = Number.isNaN(h) ? time.slice(11, 16) : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  const date = Number.isNaN(mo) ? '' : `${MONTHS[mo - 1]} ${day}`;
  return { hour, date };
}

/* ── TrendBars: "is it getting better?" — the last 24 hours of PM2.5 as tiny
   bars under the gauge, each coloured by its own AQI category. Hover names the
   hour and the µg/m³. The values are the same CAMS model series NowCast uses,
   so this is LIVE MODEL data and the caption says so. ────────────────────── */
function TrendBars({ history }) {
  const [hover, setHover] = useState(null);
  if (!history || history.length < 3) return null;
  // Oldest → newest, so the most recent reading is always the rightmost bar.
  const series = [...history].sort((a, b) => (a.time < b.time ? -1 : 1));
  const max = Math.max(...series.map((h) => h.value), 1);
  const first = timeParts(series[0].time);
  const last = timeParts(series[series.length - 1].time);

  return (
    <div className="mb-3 mt-5 pt-1">
      <div className="mb-1">
        <span className="label-caps">PM2.5 · last {series.length} hrs</span>
      </div>
      <div className="relative flex h-12 items-end gap-px" onMouseLeave={() => setHover(null)}>
        {series.map((h, i) => {
          const cat = aqiCategory(pm25Aqi(h.value));
          return (
            <div
              key={h.time}
              onMouseEnter={() => setHover(i)}
              className="min-w-0 flex-1 cursor-help rounded-sm transition-opacity"
              style={{
                height: `${Math.max((h.value / max) * 100, 5)}%`,
                background: cat.color,
                opacity: hover == null || hover === i ? 1 : 0.35,
              }}
            />
          );
        })}
        {hover != null && (
          <div
            className="pointer-events-none absolute bottom-full z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-grid-strong bg-cream px-2 py-1 text-[11px] text-ink shadow-xl"
            style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}
          >
            {timeParts(series[hover].time).date}, {timeParts(series[hover].time).hour} ·{' '}
            {series[hover].value.toFixed(1)} µg/m³
          </div>
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-ink-muted">
        <span>
          {first.date}, {first.hour}
        </span>
        <span>
          {last.date}, {last.hour} (now)
        </span>
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

// AirNow parameter names → tidy display labels (ozone spelled O₃, not O3).
const MEASURED_LABELS = { 'PM2.5': 'PM2.5', O3: 'O₃', PM10: 'PM10' };

/* ── ProvenanceSection: ONE source of truth for the headline number, in its own
   titled section. The most accurate source wins and is the ONLY one shown, so
   the reader is never handed two contradictory provenance lines:
     • measured  → a real AirNow monitor reading (headline + per-pollutant chips)
     • fallback  → nearest monitor's typical annual average (live data is down)
     • scenario  → the preset's blurb
     • modeled   → CAMS estimate + how far the nearest real monitor is (the gap)
   The nearest-monitor "your number is a model stretched over that gap" line only
   appears in the MODELED case — when a monitor reading exists it would be a lie. */
function SourceLink({ source }) {
  if (!source) return null;
  return (
    <p className="mt-2 text-[11px] text-ink-muted">
      Source:{' '}
      <a href={source.url} target="_blank" rel="noreferrer" className="text-data-primary underline">
        {source.label}
      </a>
    </p>
  );
}

function ProvenanceSection({ measured, modeled, result, current, nowcast, monitor }) {
  if (measured) {
    return (
      <Section title="Source">
        <p className="mb-3 pb-1 text-[11px] leading-snug text-ink">
          <strong>Detected from a PM2.5 air monitor</strong> — the{' '}
          <strong>{measured.reportingArea}</strong> reporting area
          {measured.distanceMi != null && <> ({measured.distanceMi} mi away)</>}, {measured.observedAt},
          via AirNow (US EPA).
        </p>
      </Section>
    );
  }

  if (result.fallback) {
    return (
      <Section title="Source">
        <p className="text-xs leading-relaxed text-ink">
          <strong>Live data is unavailable right now.</strong> This is the{' '}
          <strong>typical annual average</strong> PM2.5 from the nearest EPA monitor (
          {result.fallback.distanceMi} mi away, 2024) — a stand-in for the usual air here, not
          today’s reading.
        </p>
      </Section>
    );
  }

  if (result.blurb) {
    return (
      <Section title="About this scenario">
        <p className="text-xs leading-relaxed text-ink-muted">{result.blurb}</p>
      </Section>
    );
  }

  // Modeled: no monitor reading nearby.
  return (
    <Section title="Source">
      <p className="text-xs leading-relaxed text-ink-muted">
        <strong>Modeled, not detected</strong> — interpolated between distant monitors (CAMS model,
        ~11 km grid), the same kind of estimate most phone apps show
        {modeled.driver ? (
          <>
            . Today’s driver: <strong>{modeled.driver}</strong>
          </>
        ) : (
          ''
        )}
        .
      </p>
      <SubIndexStrip current={current} driver={modeled.driver} nowcast={nowcast} />
      {monitor && (
        <p className="mt-2 rounded-lg border border-dashed border-grid-strong bg-cream/60 px-3 py-2 text-xs leading-relaxed text-ink">
          The nearest regulatory PM2.5 monitor is <strong>{monitor.distanceMi} mi</strong> away —{' '}
          {monitor.name} ({monitor.county} County, {monitor.state}). Your number is a model stretched
          over that gap. Only ~1 in 5 US counties has one at all.
        </p>
      )}
    </Section>
  );
}

/* ── MeasuredPills: the AirNow PM2.5 / O₃ / PM10 chips. Live under the odometer
   and above the Source block so the headline number’s ingredients are visible
   before the provenance copy. Hover blurbs unchanged. ─────────────────────── */
function MeasuredPills({ measured }) {
  if (!measured) return null;
  const keys = ['PM2.5', 'O3', 'PM10'].filter((k) => measured.parameters[k]);
  if (keys.length === 0) return null;
  return (
    <div className="mb-2 mt-1 flex flex-wrap gap-1">
      {keys.map((k) => {
        const p = measured.parameters[k];
        const isDriver = k === measured.driver;
        const cat = aqiCategory(p.aqi);
        return (
          <Tip key={k} text={POLLUTANT_BLURBS[k] ?? POLLUTANT_BLURBS[MEASURED_LABELS[k]]}>
            <span
              className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                isDriver
                  ? 'border-ink bg-ink font-semibold text-cream'
                  : 'border-grid-strong text-ink'
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
          </Tip>
        );
      })}
    </div>
  );
}

/* ── MeasuredComparisonSection: CAMS model vs a real monitor reading, as two
   AQI bars. Always shown when a live model number exists — if no monitor is
   nearby the "measured" bar stays empty so the gap itself is the point. ──── */
function MeasuredComparisonSection({ modeled, measured }) {
  const measuredAqi = measured?.aqi ?? null;
  const modelAqi = modeled?.aqi ?? null;
  if (modelAqi == null && measuredAqi == null) return null;
  const top = Math.max(modelAqi ?? 0, measuredAqi ?? 0, 50);

  return (
    <Section title="What’s been measured?">
      <div className="grid gap-2">
        <CompareBar
          label="CAMS model"
          value={modelAqi}
          top={top}
          note={modeled?.driver ? `driver: ${modeled.driver}` : null}
        />
        <CompareBar
          label="Monitor"
          value={measuredAqi}
          top={top}
          emptyLabel="Unavailable"
          note={
            measured
              ? `${measured.reportingArea}${measured.distanceMi != null ? ` · ${measured.distanceMi} mi` : ''}`
              : 'No nearby AirNow reading'
          }
        />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-ink-muted">
        Most phone apps show the CAMS model. The particle makeup below is modeled from that CAMS
        air
        {measuredAqi != null ? ', even when a monitor drives the headline above' : ''}.
      </p>
    </Section>
  );
}

function CompareBar({ label, value, top, note, emptyLabel = '—' }) {
  const available = value != null;
  const pct = available ? Math.min(value / top, 1) * 100 : 0;
  const cat = available ? aqiCategory(value) : null;
  return (
    <div className={`rounded-md border px-2.5 py-2 ${available ? 'border-grid-strong' : 'border-dashed border-grid-strong/70 opacity-60'}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular-nums text-ink-muted">
          {available ? (
            <>
              <strong className="text-ink" style={{ color: cat.color }}>
                {value}
              </strong>{' '}
              AQI
            </>
          ) : (
            emptyLabel
          )}
        </span>
      </div>
      <span className="block h-2 overflow-hidden rounded-full bg-grid-medium">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background: available ? cat.color : 'transparent',
          }}
        />
      </span>
      {note && <p className="mt-1 text-[10px] leading-snug text-ink-muted">{note}</p>}
    </div>
  );
}

function Readout({ result, view, hidden, onToggle, source }) {
  const { location, current, nowcast, monitor } = result;
  const modeled = headlineAqi(current, nowcast);
  // A real AirNow reading, when one exists near the search, becomes the headline
  // and demotes the CAMS model to a comparison — the measured/modeled gap is the
  // whole point of the piece.
  const measured = result.measured?.available ? result.measured : null;
  const displayAqi = measured ? measured.aqi : modeled.aqi;
  const category = aqiCategory(displayAqi);
  // The comparison only makes sense against a live model AQI (not the
  // typical-annual fallback).
  const modelForCompare = result.fallback ? null : modeled;

  return (
    // The cap tracks the diagram beside it. Fixed px, not vh — see the preview
    // quirk in CLAUDE.md.
    <div className="max-h-[560px] overflow-y-auto rounded-lg border border-grid-strong bg-cream/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl italic">{location.name}</h3>
        {/* Provenance settled BEFORE the number is read. */}
        <ProvenanceBadge
          measured={!!measured}
          fallback={!!result.fallback}
          scenario={!!result.blurb}
        />
      </div>

      <AqiMeter aqi={displayAqi} category={category} />
      <MeasuredPills measured={measured} />
      <SourceLink source={source} />

      {/* Provenance, directly under the reading — above the dividing rule. */}
      <ProvenanceSection
        measured={measured}
        modeled={modeled}
        result={result}
        current={current}
        nowcast={nowcast}
        monitor={monitor}
      />

      <TrendBars history={result.history} />

      {modelForCompare?.aqi != null && (
        <MeasuredComparisonSection modeled={modelForCompare} measured={measured} />
      )}

      <div className="mt-4 border-t border-grid-strong pt-4">
        {view === 'source' ? (
          <SourceLegend current={current} mode="legal" hidden={hidden} onToggle={onToggle} />
        ) : (
          <PollutantList current={current} />
        )}
      </div>
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
    <div className="mb-3 mt-2">
      <div className="flex flex-wrap gap-1">
        {items.map((d) => {
          const isDriver = d.label === driver;
          const cat = aqiCategory(d.aqi);
          return (
            <Tip key={d.key} text={POLLUTANT_BLURBS[d.label]}>
              <span
                className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
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
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

function SourceLegend({ current, mode, hidden, onToggle }) {
  const breakdown = particleBreakdown(current, mode);
  // The five regulated sources make up the "official" breath, so their shares
  // sum to 100%. Ultrafine sits OUTSIDE that 100% — it's never in the mass
  // number — so it gets its own row with a raw count, not a percent.
  // Sources that round to 0% are dropped — they aren't really in this air.
  const sources = SOURCES.map((s) => ({
    ...s,
    pct: Math.round((breakdown.fractions[s.key] ?? 0) * 100),
  })).filter((s) => s.pct > 0);

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
        By volume a breath is ~78% nitrogen, ~21% oxygen and ~1% argon. Everything leftover is
        pollution (well under 0.01% of the air).
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
          <li className="mt-0.5">
            <LegendRow
              entry={{ ...ULTRAFINE, label: 'Ultrafine' }}
              off={hidden.includes(ULTRAFINE.key)}
              onToggle={onToggle}
              rose
            >
              <span className="text-xs">modeled swarm</span>
            </LegendRow>
          </li>
        )}
      </ul>
      <p className="mt-3 border-t border-grid-strong/60 pt-2 text-[10px] leading-snug text-ink-muted">
        The swarm drawn is a modeled intensity, not a count. These buckets are the modeled makeup of
        the fine-particle (PM2.5) mass — what the particles likely are, not the gases. Percentages
        are the share of the modeled particle mass, scaled against the US legal line (9 µg/m³).
        Ultrafine are so small they never enter the official mass number, so they don’t count toward
        the 100%.
      </p>
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
      <ul className="grid gap-3">
        {POLLUTANTS.map((def) => {
          const value = current[def.key];
          if (value == null) return null;
          // Same hex the ring diagram draws with — the dot, bars and ring all
          // cross-reference by colour.
          const hex = def.color;
          // One shared scale INSIDE this card (reading + both lines), so the
          // three bars compare honestly — but scales are not comparable across
          // pollutants (CO lives in the thousands, SO₂ in the tens).
          const top = Math.max(value, def.who, def.legal) * 1.05;
          // Over-the-line highlight: ONE consistent reddish wash whenever the
          // reading passes either reference line (border + background together).
          const overLine = value > def.who || value > def.legal;
          const cardTint = overLine
            ? 'border-[#D6392F]/50 bg-[#D6392F]/[0.10]'
            : 'border-grid-strong bg-cream/40';
          return (
            <li key={def.key} className={`rounded-lg border p-3 text-sm ${cardTint}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Tip text={def.blurb}>
                  <span className="flex min-w-0 cursor-help items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: hex }}
                    />
                    <span className="truncate">
                      <strong>{def.label}</strong>{' '}
                      <span className="text-xs text-ink-muted">{def.name}</span>
                    </span>
                  </span>
                </Tip>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-muted">
                  {value} {def.unit}
                </span>
              </div>
              <div className="mt-2 grid gap-1">
                <ScaleBar label="This air" value={value} top={top} color={hex} />
                <ScaleBar label="WHO line" value={def.who} top={top} />
                <ScaleBar label="US legal" value={def.legal} top={top} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Compact µg/m³ figure for the bar's right column (CO runs to 40,000).
function fmtAmount(v) {
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `${Math.round(v)}`;
  return `${v}`;
}

// One bar on the card's shared scale. The reading keeps the pollutant's own
// colour (cross-referencing the ring diagram); the two reference lines are
// neutral sand so the coloured bar reads as "the air" against "the rulers".
function ScaleBar({ label, value, top, color }) {
  const pct = Math.min(value / top, 1) * 100;
  return (
    <div className="grid grid-cols-[3.6rem_1fr_2.6rem] items-center gap-1.5 text-[10px] leading-tight">
      <span className="uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="block h-1.5 min-w-0 overflow-hidden rounded-full bg-grid-medium">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: color ?? 'rgb(var(--sand-muted))',
            opacity: color ? 1 : 0.7,
          }}
        />
      </span>
      <span className="text-right font-semibold tabular-nums">{fmtAmount(value)}</span>
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
