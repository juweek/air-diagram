import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { getByQuery } from '../data/airQuality';
import { POLLUTANTS, aqiCategory, aqiGuidance, POLLUTANT_BLURBS } from '../lib/pollutants';
import { pm25Aqi } from '../lib/nowcast';
import { SOURCES, ULTRAFINE, particleBreakdown } from '../lib/composition';
import { SCENARIOS, buildScenario } from '../data/scenarios';
import LookupInput from '../components/LookupInput';
import GourmetMediaContainer from '../components/GourmetMediaContainer';
import { Loading, ErrorState } from '../components/Status';
import P5Sketch from '../viz/P5Sketch';
import { airParticleSketch } from '../viz/airParticleSketch';
import { solarPosition, skyStops, skyCaption } from '../lib/sky';

// Open-Meteo serves CAMS *model* output on an ~11 km grid — an estimate, not a
// monitor reading. The label says so: the tool must not commit the sin the
// piece critiques (a modeled number dressed up as a measurement).
const SOURCE_LABEL =
  'Modeled interpolation between distant monitors (CAMS model, ~11 km grid)';
const SOURCE_BASE = 'https://open-meteo.com/en/docs/air-quality-api';

// Provider landing pages the per-section source links point at.
const AIRNOW_URL = 'https://www.airnow.gov/';
const EPA_PM_URL = 'https://www.epa.gov/pm-pollution/particulate-matter-pm-basics';

// AirNow ParameterName → a short noun for the provenance line ("a PM2.5 air
// monitor" / "an ozone air monitor"). Overall Current AQI is the max across
// parameters; this names the pollutant that currently drives it.
const DRIVER_MONITOR = {
  'PM2.5': { article: 'a', noun: 'PM2.5' },
  O3: { article: 'an', noun: 'ozone' },
  PM10: { article: 'a', noun: 'PM10' },
};

function measuredSourceLabel(measured) {
  // "Ozone air monitor in the Boise area (2 mi away), July 15, 2026. 7:00pm MST, via AirNow (US EPA)"
  const drive = DRIVER_MONITOR[measured.driver] ?? { article: 'a', noun: measured.driver || 'PM2.5' };
  const noun = drive.noun.charAt(0).toUpperCase() + drive.noun.slice(1);
  const area = measured.reportingArea || 'local';
  const dist = measured.distanceMi != null ? ` (${measured.distanceMi} mi away)` : '';
  const when = measured.observedAt ? `, ${measured.observedAt}` : '';
  return `${noun} air monitor in the ${area} area${dist}${when}, via AirNow (US EPA)`;
}

// The source link points at the API docs. Once we know the place, we deep-link
// to the exact coordinates we queried so "Source" reproduces this reading.
// When a real AirNow reading drives the headline, the monitor provenance IS
// the source line (no separate "Detected from…" blurb under it).
function sourceFor(location, measured = null) {
  if (measured?.available) {
    return { label: measuredSourceLabel(measured), url: AIRNOW_URL };
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
// Single source of truth for "are we on the desktop layout?" — the same
// isDesktop the page computes for the two-column split. Sections read it so
// their desktop-collapsed defaults never disagree with the layout (a separate
// matchMedia call could evaluate differently, especially in embeds).
const DesktopContext = createContext(true);

// Remembers each readout Section's open/closed state (keyed by title) across
// navigations. The Readout remounts on every place change (fresh odometer +
// focus), which would otherwise snap every section back to its default — this
// store lives in AirPage, which does NOT remount, so a section the reader
// collapsed (or opened) stays that way when they hit Random or search again.
const SectionStore = createContext(null);

export default function AirPage() {
  const { query: rawQuery } = useParams();
  const query = rawQuery ? decodeURIComponent(rawQuery) : '';
  const navigate = useNavigate();
  const state = useAsync(getByQuery, query);
  // Plain mutable map { [title]: boolean }; stable identity for the lifetime of
  // the page. Sections read their initial open state from here and write back
  // on toggle (see Section). A ref, not state — persistence only, no re-render.
  const sectionOpen = useRef({});

  const [view, setView] = useState('source'); // 'source' | 'pollutants' | 'breath'
  // Source keys the viewer has switched off in the "what's in a breath" list;
  // hidden specks are dropped from the diagram too. Immutable array so the
  // sketch memo below sees a new reference and remounts on every toggle.
  const [hidden, setHidden] = useState([]);
  const toggleSource = (key) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  // "Sky mode" — color the 3D field's background by the sun's position at the
  // searched place right now. Off by default: the flat charcoal keeps the
  // particles at maximum contrast (see lib/sky.js for the accessibility trade).
  const [showSky, setShowSky] = useState(false);
  // Within "In a breath": rings (pollution core) vs stacked to-scale zones.
  const [breathToScale, setBreathToScale] = useState(false);
  // Scenario overlay on a live place: keeps the location (and its sky) but
  // swaps the pollutant fields for an illustrative preset. null = live air.
  // Cleared whenever the URL place changes. URL scenarios (/cigarette) still
  // load via getByQuery and don't use this overlay.
  const [scenarioId, setScenarioId] = useState(null);
  useEffect(() => {
    setScenarioId(null);
  }, [query]);

  // Landing on the bare '/' , jump straight to a real place (random) shown in
  // sky mode — so the first thing you see is actual air over an actual sky, not
  // a one-off baseline demo. `replace` keeps '/' out of history so Back behaves.
  const didAutoLand = useRef(false);
  useEffect(() => {
    if (query || didAutoLand.current) return;
    didAutoLand.current = true;
    setShowSky(true);
    navigate(`/${encodeURIComponent(randomPlace(''))}`, { replace: true });
  }, [query, navigate]);

  const hasResult = state.status === 'done';
  const liveCurrent = hasResult ? state.data.current : null;
  const location = hasResult ? state.data.location : null;
  const weather = hasResult ? state.data.weather : null;
  // A place with coordinates can show sky — including while a scenario overlays
  // the fields. Pure URL scenarios have no lat/lon.
  const skyCapable = location?.latitude != null;
  const overlay = skyCapable ? buildScenario(scenarioId) : null;
  // Field current drives the canvas + composition sections. Live AQI chrome
  // (meter from monitors, trend, measured compare) stays on the place reading
  // unless we're in a pure URL scenario.
  const fieldCurrent = overlay?.current ?? liveCurrent;
  const isUrlScenario = hasResult && !!state.data.blurb && !skyCapable;

  const sun = skyCapable
    ? solarPosition(location.latitude, location.longitude)
    : null;
  const elevation = sun?.elevationDeg ?? null;
  const afternoon = sun != null ? sun.hourAngleDeg > 0 : false;
  const sky = useMemo(
    () => (showSky && skyCapable ? skyStops(elevation, weather, { afternoon }) : null),
    [showSky, skyCapable, elevation, weather, afternoon]
  );
  const skyLabel = skyCapable ? skyCaption(weather) : null;

  // Sketch view: "breath" tab maps to breathRings or breathScale via the toggle.
  const sketchView = !hasResult
    ? 'baseline'
    : view === 'breath'
      ? breathToScale
        ? 'breathScale'
        : 'breathRings'
      : view;

  // Stable objects so each P5Sketch only remounts on a real data change.
  const sketchData = useMemo(
    () => ({ current: fieldCurrent, view: sketchView, mode: 'legal', hidden, sky }),
    [fieldCurrent, sketchView, hidden, sky]
  );
  const breathData = useMemo(
    () => ({ current: fieldCurrent, view: sketchView, mode: 'legal', hidden }),
    [fieldCurrent, sketchView, hidden]
  );
  const showBreath = hasResult && view === 'breath';

  const source = hasResult
    ? overlay
      ? { label: overlay.source.label, url: overlay.source.url }
      : (state.data.source ??
        sourceFor(state.data.location, state.data.measured?.available ? state.data.measured : null))
    : sourceFor(null);

  const seeTheAir = (
    <FieldView
      showBreath={showBreath}
      view={view}
      current={fieldCurrent}
      hidden={hidden}
      onToggle={toggleSource}
      breathData={breathData}
      breathToScale={breathToScale}
      onToggleBreathScale={() => setBreathToScale((s) => !s)}
      sketchData={sketchData}
      hasResult={hasResult}
      skyCapable={skyCapable}
      showSky={showSky}
      onToggleSky={() => setShowSky((s) => !s)}
      skyLabel={skyLabel}
      scenarioId={overlay?.id ?? (isUrlScenario ? query.toLowerCase() : null)}
      onScenario={(id) => {
        if (isUrlScenario) {
          // Pure scenario URLs still navigate (shareable /cigarette addresses).
          if (id) navigate(`/${id}`);
          else navigate('/');
          return;
        }
        setScenarioId(id);
      }}
    />
  );

  // Desktop keeps the field as a left panel beside the readout. Mobile folds
  // it into an "Atmosphere" Section under the odometer. One mount only — we
  // pick a slot via matchMedia so p5 never double-runs.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 640px)').matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <DesktopContext.Provider value={isDesktop}>
      <SectionStore.Provider value={sectionOpen.current}>
      {/* ── Editorial hero: skyline first, then headline + thesis + search. ─ */}
      <section className="relative -mt-2 mb-8 pt-2 text-center">
        <HeroBars />

        <h2 className="mt-10 px-6 font-display text-5xl italic leading-[1.02] text-ink-bright sm:mt-12 sm:text-7xl lg:text-8xl">
          What’s actually
          <br />
          in the air?
        </h2>
        <p className="mx-auto mb-7 mt-6 max-w-md px-6 font-display text-lg leading-relaxed text-ink-muted">
          The line for ‘legal’ clean air is far looser than for what’s actually healthy. Search a
          place and see.
        </p>

        <div className="mx-auto mt-12 max-w-md px-6 pb-8 sm:mt-20 sm:pb-10">
          <LookupInput
            large
            defaultValue={query}
            onSubmit={(q) => navigate(`/${encodeURIComponent(q)}`)}
          />
        </div>
      </section>

      {state.status === 'loading' && <Loading label={`Looking up ${query}…`} />}
      {state.status === 'error' && <ErrorState message={state.error} />}

      <div className="mt-6">
        <GourmetMediaContainer
          title={
            hasResult
              ? `What’s in the air in ${state.data.location.name}?`
              : 'What’s in a breath — on Earth'
          }
          titleAction={
            <button
              type="button"
              onClick={() => navigate(`/${encodeURIComponent(randomPlace(query.toLowerCase()))}`)}
              className="label-caps shrink-0 rounded-md border border-grid-strong px-3 py-1.5 !text-ink transition-colors hover:!border-ink hover:!text-ink-bright"
            >
              ↺ Random
            </button>
          }
          controls={hasResult && isDesktop ? <Controls view={view} onView={setView} /> : null}
        >
          <div className="flex flex-wrap items-start justify-center gap-6 text-left sm:items-stretch">
            {/* Desktop (and baseline): field as a full left panel. */}
            {(isDesktop || !hasResult) && (
              <div className="w-full max-w-[560px] flex-1 basis-[420px] px-2.5 sm:px-0">
                {hasResult ? seeTheAir : <P5Sketch sketch={airParticleSketch} data={sketchData} />}
              </div>
            )}
            {/* No top border/gap on mobile — the city title sits flush under the card title. */}
            <aside className="flex w-full flex-1 basis-[260px] flex-col">
              {hasResult ? (
                <Readout
                  key={`${state.data.location.name}-${overlay?.id ?? 'live'}`}
                  result={state.data}
                  view={view}
                  hidden={hidden}
                  onToggle={toggleSource}
                  source={source}
                  fieldCurrent={fieldCurrent}
                  overlay={overlay}
                  // Mobile only: canvas lives under the odometer as a Section.
                  seeTheAir={isDesktop ? null : seeTheAir}
                  // Mobile only: view tabs sit under the source line (desktop
                  // keeps them in the GourmetMediaContainer buttonsDiv).
                  viewControls={
                    isDesktop ? null : <Controls view={view} onView={setView} />
                  }
                />
              ) : (
                <BaselineNote />
              )}
            </aside>
          </div>
        </GourmetMediaContainer>
      </div>
      </SectionStore.Provider>
    </DesktopContext.Provider>
  );
}

/* ── HeroBars: the hero's "bar chart rising out of the charcoal" band. A fixed
   pseudo-random skyline of thin bars whose TOPS fade to nothing (a vertical
   mask runs transparent→solid downward), so the lines emerge from the ground
   the way the readings emerge from the dark. Deterministic seed → the skyline
   is identical on every render (no re-randomizing, no layout shift).

   Every RESHUFFLE_MS the bars gently trade heights: a tick counter reseeds a
   per-bar scaleY (±~22%), and a CSS transition (in index.css, .hero-bars rect)
   eases each bar there. Transform-only — no layout, no repaint of anything but
   the bars — and each bar keeps its slot, so the skyline breathes rather than
   rearranges. Skipped under prefers-reduced-motion and in hidden tabs. ─────── */
const RESHUFFLE_MS = 2000;
// Deterministic PRNG so a given (bar, tick) pair always lands the same height.
function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function HeroBars() {
  const bars = useMemo(() => {
    const rand = seededRand(41);
    const n = 120;
    return Array.from({ length: n }, (_, i) => ({
      x: (i / n) * 1200,
      w: (1200 / n) * 0.5,
      h: 14 + rand() * (rand() < 0.18 ? 128 : 78), // mostly short, a few spikes
    }));
  }, []);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, RESHUFFLE_MS);
    return () => clearInterval(id);
  }, []);

  // Per-bar height multipliers for this tick. Tick 0 is exactly 1 (the seeded
  // skyline as designed); later ticks drift each bar within ±22% of its base.
  const scales = useMemo(() => {
    if (tick === 0) return bars.map(() => 1);
    const rand = seededRand(tick * 7919 + 13);
    // Wider swing than before (~±40%) so the skyline visibly heaves each tick.
    return bars.map(() => 0.6 + rand() * 0.8);
  }, [bars, tick]);

  return (
    <svg
      viewBox="0 0 1200 150"
      preserveAspectRatio="none"
      className="mt-2 h-24 w-full sm:h-36"
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
          <rect
            key={i}
            x={b.x}
            y={150 - b.h}
            width={b.w}
            height={b.h}
            rx="1"
            style={{ transform: `scaleY(${scales[i]})` }}
          />
        ))}
      </g>
    </svg>
  );
}

/* ── ScenarioBar: illustrative presets overlaid on the current place. Picking
   one keeps the location (and its sky) and swaps only the pollutant fields.
   "Current air quality" clears the overlay and restores the live reading. ── */
function ScenarioBar({ activeId, onPick }) {
  return (
    <div className="mt-3 flex justify-center">
      <select
        value={activeId ?? ''}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label="Try a scenario"
        className="label-caps cursor-pointer rounded-full border border-grid-strong bg-transparent px-4 py-2 !text-ink transition-colors hover:!border-ink focus:!border-ink focus:outline-none"
      >
        <option value="">Current air quality</option>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── CanvasToggle: map-style on/off chip over the field (sky mode, separate).
   Label stays fixed; pressed = on (solid ink), unpressed = off (cream chip). */
function CanvasToggle({ pressed, onClick, title, label }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={`label-caps rounded-md border px-2.5 py-1 shadow-sm backdrop-blur-sm transition-colors ${
        pressed
          ? 'border-ink/80 bg-ink/90 !text-cream'
          : 'border-cream/50 bg-cream/90 !text-ink hover:!bg-cream'
      }`}
    >
      {label}
    </button>
  );
}

/* ── FieldLayerToggles: checkboxes under the Atmosphere canvas to show/hide
   layers. Particles / breath → modeled PM2.5 sources; Pollutants → API species.
   Same `hidden` set the sketch already reads. ─────────────────────────────── */
function FieldLayerToggles({ view, current, hidden, onToggle }) {
  if (!current || !onToggle) return null;

  // Compact µg/m³ label: one decimal under 100, whole numbers above.
  const fmt = (v) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1));

  let rows = [];
  if (view === 'pollutants') {
    rows = POLLUTANTS.filter((d) => current[d.key] != null && current[d.key] > 0).map((d) => ({
      key: d.key,
      label: d.label,
      color: d.color,
      // Raw reading as a subhead so the amounts can be compared row to row.
      sub: `${fmt(current[d.key])} ${d.unit}`,
      desc: d.blurb,
    }));
  } else {
    // source + breath tabs: modeled particle makeup
    const breakdown = particleBreakdown(current, 'legal');
    const pm25 = current.pm2_5 ?? 0;
    rows = SOURCES.map((s) => {
      const frac = breakdown.fractions[s.key] ?? 0;
      return {
        key: s.key,
        label: s.label,
        color: s.color,
        pct: Math.round(frac * 100),
        // Modeled share of the PM2.5 mass (≈ — an apportioning, not a measurement).
        sub: pm25 > 0 ? `≈${fmt(frac * pm25)} µg/m³` : null,
        desc: s.blurb,
      };
    }).filter((s) => s.pct > 0);
    if (breakdown.ultrafine > 0) {
      // Ultrafine sits OUTSIDE the PM2.5 mass — no µg/m³ share to quote.
      rows.push({
        key: ULTRAFINE.key,
        label: ULTRAFINE.label,
        color: ULTRAFINE.color,
        sub: 'outside PM2.5 mass',
        desc: ULTRAFINE.blurb,
      });
    }
  }
  if (rows.length === 0) return null;

  const cols = view === 'pollutants' ? 'grid-cols-2' : 'grid-cols-1';
  return (
    <div className="mt-4">
      <ul className={`grid ${cols} items-start gap-2 text-left`}>
        {rows.map((e) => (
          <LayerToggle
            key={e.key}
            entry={e}
            off={hidden.includes(e.key)}
            onToggle={onToggle}
            sub={e.sub}
            pct={e.pct}
            desc={e.desc}
          />
        ))}
      </ul>
    </div>
  );
}

/* ── LayerToggle: one boxed checkbox row in the Atmosphere panel — a color dot +
   label + raw-amount subhead, a share % ("of particles") on the right, and a "?"
   that expands a short description of that particle/pollutant. The toggle and the
   "?" are separate buttons (no nested buttons), both inside one card. ───────── */
function LayerToggle({ entry, off, onToggle, sub, pct, desc }) {
  const [showDesc, setShowDesc] = useState(false);
  const onKey = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(entry.key);
    }
  };
  return (
    <li
      className={`overflow-hidden rounded-md border transition-colors ${
        off ? 'border-grid-strong/40 opacity-50' : 'border-grid-strong bg-ink/[0.05]'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onKeyDown={onKey}
        onClick={() => onToggle(entry.key)}
        aria-pressed={!off}
        className="grid min-w-0 grid-cols-[16px_12px_1fr_auto] items-center gap-2.5 px-3 py-2 text-left text-sm"
      >
        <span
          className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
            off ? 'border-grid-strong text-transparent' : 'border-ink bg-ink text-cream'
          }`}
        >
          ✓
        </span>
        <span className="h-3 w-3 rounded-full" style={{ background: entry.color }} />
        <span className="min-w-0">
          <span className="inline-flex items-center gap-1">
            <span className={off ? 'line-through' : ''}>{entry.label}</span>
            {desc && (
              <InlineInfoButton
                label={`What is ${entry.label}?`}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowDesc(true);
                }}
              />
            )}
          </span>
          {sub != null && (
            <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-ink-muted">
              {sub}
            </span>
          )}
        </span>
        {pct != null && (
          <span className="text-right leading-tight">
            <span className="font-semibold tabular-nums">{pct}%</span>
            <span className="block text-[9px] font-normal uppercase tracking-wide text-ink-muted">
              of particles
            </span>
          </span>
        )}
      </div>
      {desc && (
        <InfoModal open={showDesc} title={entry.label} body={desc} onClose={() => setShowDesc(false)} />
      )}
    </li>
  );
}

/* ── FieldView: the particle/pollutant/breath canvas plus sky / separate
   toggles, layer checkboxes, and scenario picker. ─────────────────────────── */
function FieldView({
  showBreath,
  view,
  current,
  hidden,
  onToggle,
  breathData,
  breathToScale,
  onToggleBreathScale,
  sketchData,
  hasResult,
  skyCapable,
  showSky,
  onToggleSky,
  skyLabel,
  scenarioId,
  onScenario,
}) {
  // Layer show/hide is mobile-only — desktop has room to read the full field.
  const toggles = hasResult ? (
    <div className="sm:hidden">
      <FieldLayerToggles view={view} current={current} hidden={hidden} onToggle={onToggle} />
    </div>
  ) : null;

  if (showBreath) {
    return (
      <>
        {/* Same map-control overlay as sky mode: chip pinned to the canvas. */}
        <div className="relative mx-auto max-w-[360px] rounded-lg bg-cream p-2">
          <P5Sketch sketch={airParticleSketch} data={breathData} />
          <div className="absolute right-2 top-2 z-10">
            <CanvasToggle
              pressed={breathToScale}
              onClick={onToggleBreathScale}
              title="Toggle between the pollution-core rings and the stacked separate breath"
              label="separate"
            />
          </div>
        </div>
        {hasResult && <ScenarioBar activeId={scenarioId} onPick={onScenario} />}
        {toggles}
      </>
    );
  }
  return (
    <>
      <div className="relative mx-auto max-w-[560px]">
        <P5Sketch sketch={airParticleSketch} data={sketchData} />
        {hasResult && skyCapable && (
          <div className="absolute right-2 top-2 z-10 flex max-w-[12rem] flex-col items-end gap-1">
            <CanvasToggle
              pressed={showSky}
              onClick={onToggleSky}
              title="Tint the background by the sun’s position and current weather at this place (dimmed so the particles stay readable)"
              label="sky mode"
            />
            {showSky && skyLabel && (
              <span className="rounded-md bg-cream/90 px-1.5 py-0.5 text-[9px] leading-snug text-ink-muted shadow-sm backdrop-blur-sm">
                {skyLabel}
              </span>
            )}
          </div>
        )}
      </div>
      {hasResult && (
        <div className="label-caps mt-2 text-center !text-ink-muted">
          drag to orbit · scroll or pinch to zoom
        </div>
      )}
      {hasResult && <ScenarioBar activeId={scenarioId} onPick={onScenario} />}
      {toggles}
    </>
  );
}

/* ── Controls: the "View" toggle. Two cuts of the same air:
     • Particulates — modeled PM2.5 origins (3D field).
     • Pollutants — gases as haze, PM as orbs (matched colors).
   ("In a breath" is temporarily removed from the toggle — the sketch/readout
   machinery for view === 'breath' is left intact so it can be re-added here.) */
function Controls({ view, onView }) {
  return (
    <Segmented
      value={view}
      onChange={onView}
      options={[
        { value: 'source', label: 'Particles in the air' },
        { value: 'pollutants', label: 'Pollutants in the air' },
      ]}
    />
  );
}

function Segmented({ value, onChange, options }) {
  return (
    // Standalone borders so these read correctly both in buttonsDiv (desktop)
    // and under the odometer source line (mobile).
    <div className="flex w-full flex-wrap justify-center gap-2 sm:inline-flex sm:w-auto sm:justify-start">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
            value === opt.value
              ? '!border-ink !bg-ink !text-cream'
              : 'border-grid-strong text-ink-muted hover:!border-ink hover:!text-ink'
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

function InfoIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="10" cy="10" r="8.3" />
      <path d="M7.6 7.3a2.4 2.4 0 0 1 4.8 0c0 1.6-2.4 1.8-2.4 3.4" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function InlineInfoButton({ label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-grid-strong/60 text-ink-muted transition-colors hover:border-ink hover:text-ink"
    >
      <InfoIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function InfoModal({ open, title, body, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-lg border border-grid-strong bg-cream p-4 text-ink shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h5 className="text-base font-semibold">{title}</h5>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-grid-strong px-2 py-0.5 text-xs font-semibold text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{body}</p>
      </div>
    </div>,
    document.body,
  );
}

/* ── Section icons (collapsed-header affordances). Stroke-based so they stay
   sharp at 18px and match the ink palette. ───────────────────────────────── */
function IconHistogram({ className = 'h-[18px] w-[18px]' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V8" strokeLinecap="round" />
    </svg>
  );
}
function IconBars({ className = 'h-[18px] w-[18px]' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 18h4V8H4v10Zm6 0h4V4h-4v14Zm6 0h4v-6h-4v6Z" strokeLinejoin="round" />
    </svg>
  );
}
function IconPie({ className = 'h-[18px] w-[18px]' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" strokeLinejoin="round" />
      <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
    </svg>
  );
}
function IconField({ className = 'h-[18px] w-[18px]' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="6" cy="8" r="1.5" />
      <circle cx="14" cy="6" r="1.2" />
      <circle cx="19" cy="11" r="1.4" />
      <circle cx="9" cy="14" r="1.6" />
      <circle cx="16" cy="17" r="1.3" />
      <circle cx="5" cy="18" r="1.1" />
    </svg>
  );
}
function SafetyCount({ n, level = 'ok' }) {
  // ok = all under WHO · who = over WHO health line · legal = over US legal line
  const styles =
    level === 'legal'
      ? 'bg-[#D6392F] text-cream'
      : level === 'who'
        ? 'bg-[#C7A70A] text-[#1f1c19]'
        : 'bg-ink/15 text-ink-muted';
  const tip =
    level === 'legal'
      ? `${n} pollutant${n === 1 ? '' : 's'} over the US legal line`
      : level === 'who'
        ? `${n} pollutant${n === 1 ? '' : 's'} over the WHO health line`
        : 'None over the WHO health line';
  return (
    <span
      className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${styles}`}
      title={tip}
      aria-label={tip}
    >
      {n}
    </span>
  );
}

// Period-separated tip count for "What should you do?" — Good (green) stays
// gray so the badge doesn't cheerlead; every other AQI band uses its own color.
function AdviceCount({ n, category }) {
  const isGood = category?.name === 'Good';
  const isYellow = category?.color === '#C7A70A';
  const tip = `${n} guidance tip${n === 1 ? '' : 's'} for this air`;
  return (
    <span
      className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
        isGood ? 'bg-ink/15 text-ink-muted' : isYellow ? 'text-[#1f1c19]' : 'text-cream'
      }`}
      style={isGood ? undefined : { background: category.color }}
      title={tip}
      aria-label={tip}
    >
      {n}
    </span>
  );
}

/* ── Section: collapsible readout card. Soft sand wash so they lift off the
   charcoal readout panel (cream = --ground in this skin — an orange tint at
   low opacity disappears into it). ─────────────────────────────────────────── */
const SECTION_BG = 'bg-ground-lift/40';

function Section({
  title,
  icon,
  badge = null,
  // Both layouts start collapsed by default — the readout reads as a tidy stack
  // of headers. Mobile opens only the section that opts in via defaultOpen
  // (Atmosphere); desktop opens only the ones that opt in via desktopOpen
  // (currently none). Evaluated once at mount.
  defaultOpen = false,
  desktopOpen = false,
  keepMounted = false,
  children,
}) {
  const isDesktop = useContext(DesktopContext);
  const store = useContext(SectionStore);
  // Persisted choice wins over the default; a section the reader has touched
  // stays how they left it across navigations (see SectionStore in AirPage).
  const [open, setOpen] = useState(() =>
    store && title in store ? store[title] : isDesktop ? desktopOpen : defaultOpen
  );
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      if (store) store[title] = next;
      return next;
    });
  return (
    <section className={`mt-6 rounded-lg border border-grid-strong ${SECTION_BG}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3.5 text-left sm:px-4"
      >
        <h4 className="font-subtitle text-xl leading-tight text-ink sm:text-2xl">{title}</h4>
        <span className="flex shrink-0 items-center gap-2 text-ink-muted">
          {badge}
          {icon}
          <span className="text-xs tabular-nums opacity-60" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>
      {(open || keepMounted) && (
        <div
          className={`rounded-b-lg border-t border-grid-strong/40 bg-cream/50 px-3.5 pb-5 pt-3.5 sm:px-4 ${
            open ? 'block' : 'hidden'
          }`}
        >
          {children}
        </div>
      )}
    </section>
  );
}

/* ── AlertBanner: one NWS air-alert card, each with its own ⚠ badge. The alert's
   OWN text is the answer, so we show it inline: the affected areas (areaDesc)
   and the message (description) — the first paragraph by default, the rest on
   "Read full alert". No link-out; the old per-alert NWS pages were retired and
   the feed's `web` field is just weather.gov. Coverage caveat: these alerts are
   authored by state air agencies and only distributed by NWS, so silence is not
   a clean bill of air. ─────────────────────────────────────────────────────── */
function AlertBanner({ alert }) {
  const [open, setOpen] = useState(false);
  const clampText = (text, limit = 220) =>
    text && text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
  const until =
    alert.until &&
    new Date(alert.until).toLocaleString([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });

  // Specific area(s) this alert covers — the "for a specific area" part.
  const areas = (alert.areaDesc ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const areaLine =
    areas.length > 5 ? `${areas.slice(0, 5).join(', ')} +${areas.length - 5} more` : areas.join(', ');

  // The message, split into paragraphs (each internally de-wrapped). First
  // paragraph is the gist; the rest is boilerplate we tuck behind the toggle.
  const paras = (alert.description ?? '')
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  const preview = paras[0] ? clampText(paras[0]) : null;
  const hasMore = paras.length > 1 || (preview && preview !== paras[0]);
  const shown = open ? paras : preview ? [preview] : [];

  return (
    <div className="rounded-md border border-data-primary/60 bg-data-primary/10 px-2.5 py-2 text-left">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="label-caps !text-[9px] !text-data-primary">⚠ NWS alert</span>
        <span className="text-[11px] font-semibold leading-snug text-ink-bright">{alert.event}</span>
        {until && <span className="text-[10px] text-ink-muted">until {until}</span>}
      </div>
      {areaLine && <p className="mt-1 text-[10px] leading-snug text-ink-muted">{areaLine}</p>}
      {shown.map((para, i) => (
        <p key={i} className="mt-1.5 text-[11px] leading-snug text-ink">
          {para}
        </p>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1.5 text-[10px] font-semibold !text-data-primary underline"
        >
          {open ? 'Show less' : 'Read full alert'}
        </button>
      )}
      {alert.sender && <p className="mt-1.5 text-[9px] text-ink-muted">Issued by {alert.sender}</p>}
    </div>
  );
}

function AlertCount({ n }) {
  const tip = `${n} active alert${n === 1 ? '' : 's'}`;
  return (
    <span
      className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-data-primary px-1.5 text-[11px] font-bold tabular-nums text-cream"
      title={tip}
      aria-label={tip}
    >
      {n}
    </span>
  );
}

function AlertsSection({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <Section title="Alerts" icon={<AlertCount n={alerts.length} />}>
      <div className="grid gap-2">
        {alerts.map((a, i) => (
          <AlertBanner key={a.id ?? i} alert={a} />
        ))}
      </div>
    </Section>
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

function formatLocalTimestamp(time) {
  if (!time) return null;
  const { hour, date } = timeParts(time);
  const year = time.slice(0, 4);
  if (!date || !year) return null;
  return `${date}, ${year} · ${hour} local time`;
}

/* ── TrendBars: "is it getting better?" — the last 24 hours as tiny bars under
   the gauge. Bars are the PM2.5 AQI (same units as the headline score), each
   coloured by its AQI category; hover/tap names the hour, the AQI and the µg/m³.
   Tooltip clamps to the track so edge bars don’t clip the readout. Same CAMS
   series NowCast uses — LIVE MODEL, caption says so. */
function TrendBars({ history, source }) {
  const [hover, setHover] = useState(null);
  const [tipShift, setTipShift] = useState(0);
  const trackRef = useRef(null);
  const tipRef = useRef(null);

  const series = useMemo(() => {
    if (!history || history.length < 3) return null;
    // Oldest → newest, so the most recent reading is always the rightmost bar.
    return [...history].sort((a, b) => (a.time < b.time ? -1 : 1));
  }, [history]);

  // After the tip paints centered on the bar, nudge it so it stays inside the
  // track (left-edge bars shift right, right-edge left). Measure from a clean
  // -50% so a previous shift never compounds.
  useLayoutEffect(() => {
    if (hover == null || !tipRef.current || !trackRef.current) {
      setTipShift(0);
      return;
    }
    const el = tipRef.current;
    el.style.transform = 'translateX(-50%)';
    const tip = el.getBoundingClientRect();
    const track = trackRef.current.getBoundingClientRect();
    const pad = 4;
    let shift = 0;
    if (tip.left < track.left + pad) shift = track.left + pad - tip.left;
    else if (tip.right > track.right - pad) shift = track.right - pad - tip.right;
    setTipShift(shift);
  }, [hover, series]);

  if (!series) return null;

  // Plot the AQI (same scale as the headline score), not the raw µg/m³.
  const max = Math.max(...series.map((h) => pm25Aqi(h.value)), 1);
  const first = timeParts(series[0].time);
  const last = timeParts(series[series.length - 1].time);

  return (
    <Section title="What’s the trend?" icon={<IconHistogram />}>
      <div className="mb-1">
        <span className="label-caps">PM2.5 AQI · last {series.length} hrs (modeled)</span>
      </div>
      <div
        ref={trackRef}
        className="relative flex h-9 items-end gap-px overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        {series.map((h, i) => {
          const aqi = pm25Aqi(h.value);
          const cat = aqiCategory(aqi);
          return (
            <div
              key={h.time}
              onMouseEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              className="min-w-0 flex-1 cursor-help rounded-sm transition-opacity"
              style={{
                height: `${Math.max((aqi / max) * 100, 5)}%`,
                background: cat.color,
                opacity: hover == null || hover === i ? 1 : 0.35,
              }}
            />
          );
        })}
        {hover != null && (
          <div
            ref={tipRef}
            className="pointer-events-none absolute bottom-full z-50 mb-1 whitespace-nowrap rounded border border-grid-strong bg-cream px-2 py-1 text-[11px] text-ink shadow-xl"
            style={{
              left: `${((hover + 0.5) / series.length) * 100}%`,
              transform: `translateX(calc(-50% + ${tipShift}px))`,
            }}
          >
            {timeParts(series[hover].time).date}, {timeParts(series[hover].time).hour} ·{' '}
            {pm25Aqi(series[hover].value)} AQI · {series[hover].value.toFixed(1)} µg/m³
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
      <SectionSource source={source} />
    </Section>
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

// Focusable pollutants: driver label → where its numbers live. `model` is the
// CAMS per-pollutant AQI field; `airnow` the AirNow parameter name (only the
// three AirNow reports). Clicking a chip focuses the odometer AND the
// "Source" comparison on that pollutant.
const FOCUS_KEYS = {
  'PM2.5': { model: 'us_aqi_pm2_5', airnow: 'PM2.5' },
  PM10: { model: 'us_aqi_pm10', airnow: 'PM10' },
  ozone: { model: 'us_aqi_ozone', airnow: 'O3' },
  'NO₂': { model: 'us_aqi_nitrogen_dioxide' },
  'SO₂': { model: 'us_aqi_sulphur_dioxide' },
  CO: { model: 'us_aqi_carbon_monoxide' },
};
// AirNow chip labels → the canonical driver label above.
const AIRNOW_TO_DRIVER = { 'PM2.5': 'PM2.5', O3: 'ozone', PM10: 'PM10' };

/* ── PollutantChip: one pollutant sub-index pill, shared by the measured
   (AirNow) strip and the modeled (CAMS) strip. Clickable: focuses the odometer
   and the measured-comparison bars on that pollutant; click again to release.
   The hover lift + border shift is the "you can press this" affordance.

   Highlight tracks the focus: the ACTIVE chip (today's driver, or whichever is
   focused) reads at full opacity with a solid-ink border — no fill, the border
   carries the emphasis; every other chip drops to the dimmed, unfocused state,
   so the strip always mirrors what the gauge is showing. ─────────────────────── */
function PollutantChip({ label, display, aqi, isDriver, focus, onPick }) {
  const cat = aqiCategory(aqi);
  const isFocused = focus?.label === label;
  // The chip the gauge is currently showing: the focused one if anything is
  // focused, otherwise today's driver. Active = full opacity + ink border;
  // the rest recede to the unfocused (dimmed) state.
  const active = focus ? isFocused : isDriver;
  return (
    <Tip text={POLLUTANT_BLURBS[display] ?? POLLUTANT_BLURBS[label]}>
      <button
        type="button"
        onClick={() => onPick(label, aqi)}
        aria-pressed={isFocused}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full border bg-transparent px-2 py-0.5 text-[11px] transition-all duration-150 hover:-translate-y-px ${
          active ? 'border-ink font-semibold text-ink' : 'border-grid-strong text-ink'
        } ${
          isFocused
            ? 'ring-1 ring-data-primary ring-offset-1 ring-offset-transparent'
            : 'hover:border-ink-bright'
        } ${active ? 'opacity-100' : 'opacity-40'}`}
      >
        {display}
        <span className="font-bold tabular-nums" style={{ color: cat.color }}>
          {aqi}
        </span>
      </button>
    </Tip>
  );
}

/* ── ProvenanceSection (below): unique notes only — fallback / scenario blurb /
   nearest-monitor gap. Driver chips live under the odometer; measured Source:
   lives in SourceLink. */
function SourceLink({ source }) {
  if (!source) return null;
  return (
    <p className="mt-2 text-[11px] leading-snug text-ink-muted">
      Source:{' '}
      <a href={source.url} target="_blank" rel="noreferrer" className="text-data-primary underline">
        {source.label}
      </a>
    </p>
  );
}

/* ── SectionSource: the little attribution line each readout section carries, so
   every chart names — and links to — the data it actually used (AQI vs modeled
   makeup are not the same provenance; see the source objects in Readout). ──── */
function SectionSource({ source }) {
  if (!source?.text) return null;
  return (
    <p className="mt-3 rounded-md border border-grid-strong/50 bg-ground-lift/40 px-2.5 py-2 text-[10px] leading-snug text-ink-muted">
      Source:{' '}
      {source.href ? (
        <a href={source.href} target="_blank" rel="noreferrer" className="text-data-primary underline">
          {source.text}
        </a>
      ) : (
        source.text
      )}
    </p>
  );
}

/* ── WhatToDoSection: the actionable takeaway — what the headline AQI means for
   being outside today. A peer of "What's the trend?" / "Source".
   The text is the compressed EPA/AirNow activity guidance (aqiGuidance in
   pollutants.js), keyed to the same category breakpoints as the gauge. One
   bullet per period-separated tip; the badge counts them. ────────────────── */
function WhatToDoSection({ aqi, category }) {
  const advice = aqiGuidance(aqi);
  if (!advice) return null;
  // Crude but stable: one tip per substring between periods. Good air → 0 —
  // "no precautions" isn't a to-do count.
  const tips = advice
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  const tipCount = category.name === 'Good' ? 0 : tips.length;
  return (
    <Section title="What should you do?" icon={<AdviceCount n={tipCount} category={category} />}>
      <p className="mb-2 text-xs font-semibold sm:text-sm" style={{ color: category.color }}>
        {category.name}
      </p>
      <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink sm:text-sm">
        {tips.map((tip) => (
          <li key={tip}>{tip}.</li>
        ))}
      </ul>
    </Section>
  );
}

function ProvenanceSection({ measured, result, monitor }) {
  // Measured provenance lives in the Source: line under the odometer. Driver
  // chips (MeasuredPills / SubIndexStrip) also live under the odometer — do not
  // re-render them here. This block is only for unique notes: fallback, scenario
  // blurb, or the nearest-monitor gap on modeled readings.
  if (measured) return null;

  if (result.fallback) {
    return (
      <div className="mt-4 rounded-lg border border-grid-strong/50 bg-cream/50 px-3.5 py-3 sm:px-4">
        <p className="text-xs leading-relaxed text-ink">
          <strong>Live data is unavailable right now.</strong> This is the{' '}
          <strong>typical annual average</strong> PM2.5 from the nearest EPA monitor (
          {result.fallback.distanceMi} mi away, 2024) — a stand-in for the usual air here, not
          today’s reading.
        </p>
      </div>
    );
  }

  if (result.blurb) {
    return (
      <div className="mt-4 rounded-lg border border-grid-strong/50 bg-cream/50 px-3.5 py-3 sm:px-4">
        <p className="text-xs leading-relaxed text-ink-muted">{result.blurb}</p>
      </div>
    );
  }

  if (!monitor) return null;

  return (
    <div className="mt-4 rounded-lg border border-dashed border-grid-strong bg-cream/60 px-3 py-2 text-xs leading-relaxed text-ink">
      The nearest regulatory PM2.5 monitor is <strong>{monitor.distanceMi} mi</strong> away —{' '}
      {monitor.name} ({monitor.county} County, {monitor.state}). Your number is a model stretched
      over that gap. Only ~1 in 5 US counties has one at all.
    </div>
  );
}

/* ── MeasuredPills: the AirNow PM2.5 / O₃ / PM10 chips. Live under the odometer
   and above the Source block so the headline number’s ingredients are visible
   before the provenance copy. Hover blurbs unchanged. ─────────────────────── */
function MeasuredPills({ measured, focus, onPick }) {
  if (!measured) return null;
  const keys = ['PM2.5', 'O3', 'PM10'].filter((k) => measured.parameters[k]);
  if (keys.length === 0) return null;
  return (
    <div className="mb-2 mt-1 flex flex-wrap justify-center gap-1 sm:justify-start">
      {keys.map((k) => (
        <PollutantChip
          key={k}
          label={AIRNOW_TO_DRIVER[k]}
          display={MEASURED_LABELS[k]}
          aqi={measured.parameters[k].aqi}
          isDriver={k === measured.driver}
          focus={focus}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/* ── MeasuredComparisonSection: CAMS model vs a real monitor reading, each on
   the FULL 0–500 EPA color scale (the odometer unrolled flat) with a ▼ caret
   at the reading. Only render a bar when that side has a value — no empty
   "unfocused" stub for a missing monitor or model reading.
   When a pollutant chip is focused above, both bars follow it: the model bar
   shows that pollutant's CAMS sub-index, the monitor bar its AirNow reading
   (AirNow only reports PM2.5 / O₃ / PM10). ─────────────────────────────────── */
function MeasuredComparisonSection({ modeled, measured, focus, current, nowcast, source, location }) {
  let modelAqi = modeled?.aqi ?? null;
  let measuredAqi = measured?.aqi ?? null;
  // Default labels fold the old under-bar notes into the title row.
  let modelLabel = modeled?.driver ? `CAMS model (${modeled.driver})` : 'CAMS model';
  let measuredLabel = measured
    ? `Monitor (${measured.reportingArea}${measured.distanceMi != null ? ` · ${measured.distanceMi} mi` : ''})`
    : 'Monitor';

  if (focus) {
    const keys = FOCUS_KEYS[focus.label];
    modelAqi = current[keys.model] ?? null;
    if (focus.label === 'PM2.5' && nowcast?.aqi != null) {
      modelAqi = Math.max(modelAqi ?? 0, nowcast.aqi);
    }
    modelLabel = `CAMS model (${focus.label})`;
    measuredAqi = keys.airnow ? (measured?.parameters?.[keys.airnow]?.aqi ?? null) : null;
    if (measuredAqi != null && measured) {
      measuredLabel = `Monitor (${focus.label} · ${measured.reportingArea}${measured.distanceMi != null ? ` · ${measured.distanceMi} mi` : ''})`;
    } else if (measuredAqi != null) {
      measuredLabel = `Monitor (${focus.label})`;
    }
  }
  if (modelAqi == null && measuredAqi == null) return null;
  // Zoom the axis to 200 unless a reading actually reaches past it — most days
  // both bars live under 150, and a fixed 0–500 scale squashed them into
  // indistinguishable stubs. Only stretch to the full 500 when something needs it.
  const top = Math.max(modelAqi ?? 0, measuredAqi ?? 0) > 200 ? AQI_MAX : 200;
  const modelStamp = formatLocalTimestamp(current?.time);
  const drive = DRIVER_MONITOR[measured?.driver] ?? { noun: measured?.driver || 'PM2.5' };
  const area = measured?.reportingArea ? ` in the ${measured.reportingArea} area` : '';
  const dist = measured?.distanceMi != null ? ` (${measured.distanceMi} mi away from entered location)` : '';
  const when = measured?.observedAt ? ` on ${measured.observedAt}` : '';
  const liveSentence = `This reading was fetched live from ${drive.noun} air monitor${area}${dist}${when}. We fetched the data via AirNow (US EPA).`;
  const place = location?.name ? `over ${location.name}` : 'over this location';
  const modeledSentence = `This reading is the CAMS model estimate for the air ${place}${
    modelStamp ? ` on ${modelStamp}` : ''
  }.`;
  const sourceNote = `${measuredAqi != null ? liveSentence : modeledSentence} Most phone apps show the CAMS model.`;

  return (
    <Section title="Source" icon={<IconBars />}>
      <p className="mb-3 text-[10px] leading-snug text-ink-muted">{sourceNote}</p>
      <div className="grid gap-3">
        {modelAqi != null && <CompareBar label={modelLabel} value={modelAqi} top={top} />}
        {measuredAqi != null && <CompareBar label={measuredLabel} value={measuredAqi} top={top} />}
      </div>
      <SectionSource source={source} />
    </Section>
  );
}

// EPA category bands clipped to an axis that ends at `top`, each width as a % of
// that axis — so 0..top always fills the whole bar.
function bandsUpTo(top) {
  let cursor = 0;
  const segs = [];
  for (const b of AQI_BANDS) {
    const v0 = cursor;
    const v1 = cursor + b.span;
    cursor = v1;
    if (v0 >= top) break;
    segs.push({ name: b.name, color: b.color, width: ((Math.min(v1, top) - v0) / top) * 100 });
  }
  return segs;
}

// One reading on the EPA AQI spectrum (0–`top`) — the same category bands as the
// odometer, laid flat, with a caret pointing at the value. Borderless: the
// colored bar is its own frame.
function CompareBar({ label, value, top = AQI_MAX, note, emptyLabel = '—' }) {
  const available = value != null;
  const pct = available ? (Math.min(value, top) / top) * 100 : 0;
  const cat = available ? aqiCategory(value) : null;
  return (
    <div className={`py-1.5 ${available ? '' : 'opacity-60'}`}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular-nums text-ink-muted">
          {available ? (
            <>
              <strong style={{ color: cat.color }}>{value}</strong> AQI
            </>
          ) : (
            emptyLabel
          )}
        </span>
      </div>
      <div className="relative mt-1.5 px-2 pt-3">
        {available && (
          <span
            aria-hidden
            className="absolute top-0 -translate-x-1/2 text-[10px] leading-none text-ink-bright"
            style={{ left: `${pct}%` }}
          >
            ▼
          </span>
        )}
        <span
          className="flex h-3.5 overflow-hidden rounded-full"
          style={{ opacity: available ? 1 : 0.35 }}
        >
          {bandsUpTo(top).map((s) => (
            <span key={s.name} style={{ width: `${s.width}%`, background: s.color }} />
          ))}
        </span>
        <div className="mt-1 flex justify-between text-[9px] tabular-nums text-ink-muted">
          <span>0</span>
          <span>{top}</span>
        </div>
      </div>
      {note && <p className="mt-1 text-[10px] leading-snug text-ink-muted">{note}</p>}
    </div>
  );
}

function Readout({
  result,
  view,
  hidden,
  onToggle,
  source,
  fieldCurrent,
  overlay,
  seeTheAir,
  viewControls,
}) {
  const { location, current: liveCurrent, nowcast, monitor } = result;
  // Overlay swaps the field pollutants for an illustrative preset but keeps
  // the place. Live AQI chrome (meter from monitors, trend, measured compare)
  // only shows when we're on the place's real air — not a scenario overlay.
  const showingLive = !overlay && !result.blurb;
  const current = fieldCurrent ?? liveCurrent;
  const modeled = headlineAqi(current, showingLive ? nowcast : null);
  const measured = showingLive && result.measured?.available ? result.measured : null;
  const displayAqi = measured ? measured.aqi : modeled.aqi;
  const [focus, setFocus] = useState(null); // { label, aqi } | null
  const pickFocus = (label, aqi) =>
    setFocus((f) => (f?.label === label ? null : { label, aqi }));
  const shownAqi = focus ? focus.aqi : displayAqi;
  const category = aqiCategory(shownAqi);
  const modelForCompare = showingLive && !result.fallback ? modeled : null;
  const animateKey = showingLive ? `${location.name}-${liveCurrent?.time ?? ''}` : null;

  const isIllustrative = !!overlay || !!result.blurb;
  const camsUrl = sourceFor(location).url;
  const scenarioUrl = overlay?.source?.url ?? result.source?.url ?? EPA_PM_URL;
  const illustrative = { text: 'Illustrative published levels (EPA / WHO literature)', href: scenarioUrl };
  const aqiSource = isIllustrative
    ? illustrative
    : { text: source.label, href: source.url };
  const particleSource = isIllustrative
    ? illustrative
    : { text: 'Modeling from Open-Meteo (CAMS) used for particle breakdown', href: camsUrl };
  const readingsSource = isIllustrative
    ? illustrative
    : { text: 'Modeled pollutant readings and breakdowns by Open-Meteo (CAMS).', href: camsUrl };
  const historySource = {
    text: 'Modeled numbers by Open-Meteo (CAMS).',
    href: camsUrl,
  };

  return (
    // Desktop: bordered card beside the field, capped + scrollable so a long
    // list never runs past the diagram. Mobile: no extra frame — canvas folds
    // into "Atmosphere" under the odometer when seeTheAir is passed.
    <div className="sm:max-h-[840px] sm:overflow-y-auto sm:rounded-lg sm:border sm:border-grid-strong sm:bg-cream/60 sm:p-5">
      {/* City name + badge on desktop. On mobile the city is in the card title;
         the badge rides the AQI score row instead (see AqiMeter). */}
      <div className="mb-1 hidden items-start justify-between gap-3 sm:flex">
        <h3 className="font-display text-2xl italic">{location.name}</h3>
        <ProvenanceBadge
          measured={!!measured}
          fallback={showingLive && !!result.fallback}
          scenario={isIllustrative}
        />
      </div>

      {/* Live place: show the real AQI stack. Scenario overlay: hide it — the
         point is the field comparison, not a second odometer. Pure URL
         scenarios still show their illustrative AQI. */}
      {showingLive || result.blurb ? (
        <>
          <AqiMeter
            aqi={shownAqi}
            category={category}
            animateKey={animateKey}
            badge={
              <span className="sm:hidden">
                <ProvenanceBadge
                  measured={!!measured}
                  fallback={showingLive && !!result.fallback}
                  scenario={isIllustrative}
                />
              </span>
            }
          />
          {showingLive &&
            (measured ? (
              <MeasuredPills measured={measured} focus={focus} onPick={pickFocus} />
            ) : (
              <SubIndexStrip
                current={liveCurrent}
                driver={modeled.driver}
                nowcast={nowcast}
                focus={focus}
                onPick={pickFocus}
              />
            ))}
          {/* Desktop only — on mobile the Source section carries this line. */}
          {showingLive && (
            <div className="hidden sm:block">
              <SourceLink source={source} />
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Showing <strong className="text-ink">{overlay.label}</strong> over {location.name} — the
          location and sky stay put; only the particle fields change. Pick{' '}
          <strong className="text-ink">Current air quality</strong> in the scenario menu to restore
          today’s reading.
        </p>
      )}

      {overlay?.blurb && (
        <p className="mt-3 rounded-lg border border-grid-strong/50 bg-cream/50 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
          {overlay.blurb}
        </p>
      )}

      {showingLive && (
        <ProvenanceSection measured={measured} result={result} monitor={monitor} />
      )}

      {/* Mobile: view tabs under the source line, above the first Section. */}
      {viewControls && (
        <div className="mt-6 border-t border-grid-strong pt-5">{viewControls}</div>
      )}

      {/* Mobile only: field under the odometer, above Source. Desktop passes null. */}
      {seeTheAir && (
        <Section title="Atmosphere" icon={<IconField />} defaultOpen keepMounted>
          {seeTheAir}
        </Section>
      )}

      {showingLive && (modelForCompare?.aqi != null || measured) && (
        <MeasuredComparisonSection
          modeled={modelForCompare}
          measured={measured}
          focus={focus}
          current={liveCurrent}
          nowcast={nowcast}
          source={aqiSource}
          location={location}
        />
      )}
      {view === 'pollutants' && <PollutantList current={current} source={readingsSource} />}
      {showingLive && <TrendBars history={result.history} source={historySource} />}
      {showingLive && <AlertsSection alerts={result.alerts} />}

      {showingLive && (
        <WhatToDoSection aqi={displayAqi} category={aqiCategory(displayAqi)} />
      )}

      {view === 'pollutants' ? (
        <PollutantBreathSection
          current={current}
          hidden={hidden}
          onToggle={onToggle}
          source={readingsSource}
        />
      ) : (
        <SourceLegend
          current={current}
          mode="legal"
          hidden={hidden}
          onToggle={onToggle}
          source={particleSource}
        />
      )}
    </div>
  );
}

/* ── AqiMeter: an odometer-style half-gauge. The AQI (0–500) is a needle angle
   sweeping across the six EPA category bands, so the reading is read as a
   position on the danger arc — not just a number. Kept compact (side padding +
   shorter arc) so it doesn’t dominate the readout. Honest-linear over 0–500. */
const GAUGE = { cx: 100, cy: 78, r: 62, sw: 20 };

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

function AqiMeter({ aqi, category, badge = null, animateKey = null }) {
  // Mobile: thinner stroke + a vertically SHORTER arc (same width). Desktop
  // keeps the fuller semicircle.
  const [mobile, setMobile] = useState(false);
  const [needleAqi, setNeedleAqi] = useState(aqi ?? 0);
  const [jitter, setJitter] = useState(0);
  const animateRef = useRef(animateKey);
  const rafRef = useRef(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const apply = () => setMobile(!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (aqi == null) {
      setNeedleAqi(0);
      animateRef.current = animateKey;
      return undefined;
    }
    const shouldAnimate = animateKey != null && animateKey !== animateRef.current;
    animateRef.current = animateKey;
    if (!shouldAnimate) {
      setNeedleAqi(aqi);
      return undefined;
    }
    const duration = 900;
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      setNeedleAqi(easeOut(t) * aqi);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setNeedleAqi(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [aqi, animateKey]);
  useEffect(() => {
    if (aqi == null) {
      setJitter(0);
      return undefined;
    }
    let resetId;
    const id = setInterval(() => {
      const sign = Math.random() < 0.5 ? -1 : 1;
      setJitter(sign * 7);
      if (resetId) clearTimeout(resetId);
      resetId = setTimeout(() => setJitter(0), 100);
    }, 1000);
    return () => {
      clearInterval(id);
      if (resetId) clearTimeout(resetId);
    };
  }, [aqi]);
  const sw = mobile ? 14 : GAUGE.sw;

  // Turn the band spans into cumulative [v0, v1] AQI ranges to draw each arc.
  let cursor = 0;
  const bands = AQI_BANDS.map((b) => {
    const seg = { ...b, v0: cursor, v1: cursor + b.span };
    cursor += b.span;
    return seg;
  });
  const needleValue = Math.min(Math.max((needleAqi ?? 0) + jitter, 0), AQI_MAX);
  const [nx, ny] = gaugePoint(GAUGE.r - sw / 2 - 3, gaugeAngle(needleValue));

  // On mobile, squish the arc + needle vertically toward the flat baseline (cy)
  // so the gauge gets shorter without getting narrower, then crop the freed
  // space out of the viewBox. The 0/500 labels stay outside the scaled group so
  // they don't distort. Desktop is unchanged.
  const gaugeTransform = mobile
    ? `translate(0 ${GAUGE.cy}) scale(1 0.78) translate(0 ${-GAUGE.cy})`
    : undefined;
  const viewBox = mobile ? '0 20 200 78' : '0 0 200 96';

  return (
    <div className="mb-2 mt-0 px-8 sm:mb-3 sm:mt-3 sm:px-16">
      {/* Score + category top-left; optional mobile provenance badge top-right. */}
      <div className="mb-0.5 flex items-start justify-between gap-2 sm:mb-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-ink-muted">AQI:</span>
          <span className="text-3xl font-black" style={{ color: category.color }}>
            {aqi ?? '—'}
          </span>
          <span className="text-base font-semibold text-ink">{category.name}</span>
        </div>
        {badge}
      </div>
      <svg
        viewBox={viewBox}
        className="block w-full max-w-[118px] sm:mx-auto sm:max-w-[196px]"
        role="img"
        aria-label={`Air Quality Index ${aqi ?? 'unknown'} out of 500 — ${category.name}`}
      >
        <g transform={gaugeTransform}>
          {bands.map((b) => (
            <path
              key={b.name}
              d={gaugeArc(b.v0, b.v1)}
              fill="none"
              stroke={b.color}
              strokeWidth={sw}
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
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx={GAUGE.cx} cy={GAUGE.cy} r="4.5" fill="#f6efe0" />
            </>
          )}
        </g>
        <text x={GAUGE.cx - GAUGE.r} y={GAUGE.cy + 14} textAnchor="middle" fontSize="8" fill="#a8987e">
          0
        </text>
        <text x={GAUGE.cx + GAUGE.r} y={GAUGE.cy + 14} textAnchor="middle" fontSize="8" fill="#a8987e">
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
function SubIndexStrip({ current, driver, nowcast, focus, onPick }) {
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
      <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
        {items.map((d) => (
          <PollutantChip
            key={d.key}
            label={d.label}
            display={d.label}
            aqi={d.aqi}
            isDriver={d.label === driver}
            focus={focus}
            onPick={onPick}
          />
        ))}
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

  // The source split is modeled from the OTHER pollutants (NO₂, SO₂, dust…). The
  // typical-annual fallback carries only a PM2.5 mass, so there's nothing to
  // apportion — say so plainly instead of drawing an empty list.
  if (sources.length === 0 && breakdown.ultrafine === 0) {
    return (
      <Section title="What’s in the air?" icon={<IconPie />}>
        <p className="text-xs leading-relaxed text-ink-muted">
          The source breakdown needs the live pollutant mix (NO₂, SO₂, dust…), which isn’t available
          right now. Switch to <strong>Pollutants</strong> to see the PM2.5 mass we do have.
        </p>
      </Section>
    );
  }

  return (
    <Section title="What’s in the air?" icon={<IconPie />}>
      <p className="mb-2 text-xs leading-relaxed text-ink-muted">
        By volume a breath is almost entirely clean air (~78% nitrogen, ~21% oxygen, ~1% argon).
        Everything leftover is pollution (well under 0.01% of the air).
      </p>
      <BreathBars sources={sources} />
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
      <SectionSource source={source} />
    </Section>
  );
}

function PollutantBreathSection({ current, hidden, onToggle, source }) {
  const entries = POLLUTANTS.map((p) => ({
    ...p,
    value: current[p.key],
  })).filter((p) => p.value != null && p.value > 0);
  const total = entries.reduce((sum, p) => sum + p.value, 0);
  if (entries.length === 0 || total <= 0) {
    return (
      <Section title="What’s in the air?" icon={<IconPie />}>
        <p className="text-xs leading-relaxed text-ink-muted">
          Pollutant breakdown needs live species readings (O₃, NO₂, PM2.5, dust…), which aren’t
          available right now.
        </p>
      </Section>
    );
  }

  const pollutants = entries
    .map((p) => ({
      ...p,
      pct: Math.round((p.value / total) * 100),
    }))
    .filter((p) => p.pct > 0);

  return (
    <Section title="What’s in the air?" icon={<IconPie />}>
      <p className="mb-2 text-xs leading-relaxed text-ink-muted">
        By volume a breath is almost entirely clean air (~78% nitrogen, ~21% oxygen, ~1% argon).
        Everything leftover is pollution (well under 0.01% of the air). The bar below splits the
        measured pollutant mass (µg/m³) across species — a share of pollution only, not the whole
        air.
      </p>
      <BreathBars sources={pollutants} variant="pollutants" />
      <ul className="grid gap-0.5">
        {pollutants.map((e) => (
          <LegendRow key={e.key} entry={e} off={hidden.includes(e.key)} onToggle={onToggle}>
            <span className="tabular-nums">{e.pct}%</span>
          </LegendRow>
        ))}
      </ul>
      <p className="mt-3 border-t border-grid-strong/60 pt-2 text-[10px] leading-snug text-ink-muted">
        Percentages sum to 100 over measured pollutant mass, not over all air.
      </p>
      <SectionSource source={source} />
    </Section>
  );
}

/* ── BreathBars: the whole-breath picture as two linked stacked bars. Bar 1 is
   the breath itself — clean air (one gray band) vs a pollutant sliver. Bar 2
   zooms that sliver into its modeled source split (the same colors as the
   diagram and the legend rows below). Dashed connectors tie the sliver to the
   zoom, agricultural-land-chart style.

   HONESTY: pollution is well under 0.01% of a breath by volume; a true-scale
   sliver would be invisible (a fraction of a pixel). It's drawn at a fixed
   SLIVER_PCT and the caption says so — the exaggeration is disclosed, never
   implied to be data. Widths are percentage-based, so the markup works at any
   width. ─────────────────────────────────────────────────────────────────── */
const SLIVER_PCT = 0.5; // drawn width of the pollutant sliver — VISUAL ONLY
const CLEAN_AIR_COLOR = '#6B7075';

function BreathBars({ sources, variant = 'sources' }) {
  const isPollutants = variant === 'pollutants';
  return (
    <div className="mb-3 mt-1" aria-hidden>
      {/* Bar 1 — clean air vs the (exaggerated) pollutant sliver. Gas species
          stay in the caption; the bar itself stays a two-part contrast. */}
      <div className="flex h-7 overflow-hidden rounded-sm border border-grid-strong/70">
        <div
          title="Clean air · ~99.99% of a breath by volume"
          className="flex items-center justify-center overflow-hidden text-[10px] font-semibold leading-none text-cream"
          style={{ width: `${100 - SLIVER_PCT}%`, background: CLEAN_AIR_COLOR }}
        >
          Clean air
        </div>
        <div
          title="Pollution · under 0.01% (drawn larger to be visible)"
          style={{ width: `${SLIVER_PCT}%`, background: 'rgb(var(--accent))' }}
        />
      </div>

      {/* Dashed connectors: the sliver's edges fan out to bar 2's full width.
          Right edge is inset slightly so the stroke isn't half-clipped (which
          made one leg look washed out). Both legs use the same solid white. */}
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block h-7 w-full sm:h-8">
        <line
          x1={100 - SLIVER_PCT}
          y1="0"
          x2="0.5"
          y2="28"
          stroke="rgb(var(--sand-bright))"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={99.5}
          y1="0"
          x2={99.5}
          y2="28"
          stroke="rgb(var(--sand-bright))"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Bar 2 — the sliver zoomed: modeled source split (colors match the
          legend rows below and the specks in the diagram) */}
      <div className="flex h-7 overflow-hidden rounded-sm border border-grid-strong/70">
        {sources.map((s) => (
          <div
            key={s.key}
            title={`${s.label} · ${s.pct}%${isPollutants ? ' of pollutant mass' : ''}`}
            className="flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-semibold leading-none text-[#1f1c19]"
            style={{ width: `${s.pct}%`, background: s.color }}
          >
            {s.pct >= 14 ? `${s.pct}%` : ''}
          </div>
        ))}
      </div>

      <p className="mt-1.5 text-[10px] leading-snug text-ink-muted">
        The top bar is a breath by volume — almost all clean air (N₂, O₂, Ar). The pollutant sliver
        at its end is really under 0.01%.
      </p>
    </div>
  );
}

// One tappable legend row: checkbox + color dot + label + value — the tight
// legend in "What's in a breath". Off = dimmed, unchecked box, struck-through.
// (The Atmosphere panel's richer boxed rows are LayerToggle, above.)
function LegendRow({ entry, off, onToggle, rose, children }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(entry.key)}
      aria-pressed={!off}
      className={`grid w-full grid-cols-[16px_12px_1fr_auto] items-center gap-2.5 rounded py-0.5 text-left text-sm transition-colors hover:bg-ink/10 ${
        off ? 'opacity-40' : ''
      } ${rose ? 'text-rose' : ''}`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${
          off ? 'border-grid-strong text-transparent' : 'border-ink bg-ink text-cream'
        }`}
      >
        ✓
      </span>
      <span className="h-3 w-3 rounded-full" style={{ background: entry.color }} />
      <span className={off ? 'line-through' : ''}>{entry.label}</span>
      <span className="font-semibold tabular-nums">{children}</span>
    </button>
  );
}

function PollutantList({ current, source }) {
  const [info, setInfo] = useState(null);
  // US legal is the looser line — over-legal ⊆ over-WHO for the same pollutant.
  // Badge count = over WHO; color escalates to red when any also clear US legal.
  let overWho = 0;
  let overLegal = 0;
  for (const def of POLLUTANTS) {
    const value = current[def.key];
    if (value == null) continue;
    if (value > def.who) overWho += 1;
    if (value > def.legal) overLegal += 1;
  }
  const level = overLegal > 0 ? 'legal' : overWho > 0 ? 'who' : 'ok';

  return (
    <Section
      title="Is this safe?"
      icon={<SafetyCount n={overWho} level={level} />}
    >
      <p className="mb-3 rounded-md bg-cream/60 px-2.5 py-2 text-[11px] leading-snug text-ink">
        Two different lines answer that. The WHO’s comes from the health research — the point where
        your body starts paying for it. The US legal line sits a lot higher up. “Legal” and “safe”
        aren’t the same thing, and plenty of air lands in the gap between them. Each pollutant below
        is measured against both.
      </p>
      <ul className="grid gap-3">
        {POLLUTANTS.map((def) => {
          const value = current[def.key];
          if (value == null) return null;
          const hex = def.color;
          const top = Math.max(value, def.who, def.legal) * 1.05;
          // Over the US legal line is red; over the WHO health line but still
          // under legal is yellow (the gap the piece is about); under both is
          // neutral. Legal is always the looser line, so over-legal ⊆ over-WHO.
          const overLegal = value > def.legal;
          const overWhoOnly = value > def.who && !overLegal;
          const cardTint = overLegal
            ? 'border-[#D6392F]/50 bg-[#D6392F]/[0.10]'
            : overWhoOnly
              ? 'border-[#C7A70A]/60 bg-[#C7A70A]/[0.12]'
              : 'border-grid-strong bg-cream/40';
          const isGas = def.form === 'gas';
          return (
            <li key={def.key} className={`rounded-lg border p-3 text-sm ${cardTint}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`h-2.5 shrink-0 ${isGas ? 'w-3.5 rounded-sm opacity-80' : 'w-2.5 rounded-full'}`}
                    style={{ background: hex }}
                    title={isGas ? 'Drawn as haze' : 'Drawn as particle orb'}
                  />
                  <span className="truncate">
                    <strong>{def.label}</strong>{' '}
                    <span className="text-xs text-ink-muted">{def.name}</span>
                  </span>
                  {def.blurb && (
                    <InlineInfoButton
                      label={`What is ${def.label}?`}
                      onClick={() => setInfo({ title: def.label, body: def.blurb })}
                    />
                  )}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      isGas ? 'bg-data-primary/15 text-data-primary' : 'bg-ink/10 text-ink-muted'
                    }`}
                  >
                    {isGas ? 'gas' : 'particle'}
                  </span>
                </span>
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
      <SectionSource source={source} />
      <InfoModal open={!!info} title={info?.title} body={info?.body} onClose={() => setInfo(null)} />
    </Section>
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
    <div className="sm:rounded-lg sm:border sm:border-grid-strong sm:bg-cream/60 sm:p-5">
      <h3 className="font-display text-2xl italic">What’s in a breath — on Earth</h3>
      <p className="mt-2 leading-relaxed text-ink-muted">
        Clean air by volume: ~78% nitrogen, ~21% oxygen, ~1% argon, plus CO₂, neon, and other trace
        gases. Pollution is the tiny leftover. Search a place above and the rings redraw for that
        air instead.
      </p>
    </div>
  );
}
