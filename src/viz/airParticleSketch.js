import { POLLUTANTS, pollutantNorm } from '../lib/pollutants.js';
import {
  SOURCES,
  ULTRAFINE,
  AIR_GASES,
  particleBreakdown,
  pollutantAbundance,
} from '../lib/composition.js';

/**
 * The air-particle diagram, as a pure p5 sketch: airParticleSketch(p, data).
 * No global mode, no controller — P5Sketch.jsx owns mount/teardown and re-runs
 * this whenever `data` changes. `data = { current, view, mode, hidden }`:
 *   view: 'baseline' | 'source' | 'pollutants' | 'breathRings' | 'breathScale'
 *         baseline    = Earth's clean breath (N₂/O₂/Ar rings)
 *         source      = 3D field of MODELED PM2.5 origins
 *         pollutants  = measured species: gases as soft haze, PM as orbs
 *         breathRings = N₂/O₂/Ar as big outer rings around a tiny pollution core
 *         breathScale = two stacked zones: the breath, then its pollution zoomed
 *   mode: 'legal' | 'who' | 'current'        (which reference / scale)
 *   current: the Open-Meteo `current` readings (null in baseline view)
 *   sky: null | [top, mid, horizon] RGB triples (lib/sky.js) — when set, the
 *        3D field's floor is a vertical sky gradient for the place's current
 *        sun position instead of the flat charcoal.
 *
 * RENDERING (Style-2 charcoal): two deliberately different languages —
 *
 *   • The source / pollutant fields are a 3D VOLUME of luminous orbs (and, for
 *     gases in the pollutant view, a few large soft haze puffs drawn behind
 *     the PM orbs). Specks live in 3D; each frame we rotate, project, and blit
 *     cached radial-glow sprites with additive compositing — raw
 *     ctx.drawImage, no tint(), no WebGL. Interaction: drag to orbit,
 *     wheel/pinch to zoom; vertical swipes still scroll (touch-action: pan-y).
 *
 *   • The baseline atmosphere and the breath rings are CRISP: plain
 *     white-outlined dots (the original diagram), which read far clearer for
 *     concentric structure than soft glow does.
 */

const CANVAS_MAX = 800;
const BASE_PULSE_SPEED = 0.1;

// The canvas floor mirrors the --ground design token (see index.css). Reading it
// from CSS keeps the sketch in sync with a theme swap instead of hard-coding it.
const GROUND_FALLBACK = [31, 28, 25];
function groundColor() {
  if (typeof window === 'undefined') return GROUND_FALLBACK;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? parts : GROUND_FALLBACK;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/* ── The 3D source field ──────────────────────────────────────────────────── */

// Camera state lives at module level so orbit/zoom survive the React remounts
// that happen on every toggle (P5Sketch remounts whenever `data` changes).
const cam = { yaw: -0.35, pitch: 0.12, zoom: 1 };
// minZoom pulls PAST the volume edge so you can scroll the patch farther out
// and read the cloud as one round area of mostly-empty air.
const CAM = { minZoom: 0.28, maxZoom: 3, maxPitch: 1.25, idleSpin: 0.0012 };

// One soft radial-gradient sprite per colour, pre-rendered once on a raw canvas.
// Deliberately dim: with additive compositing, clustered orbs sum toward light,
// so a low per-orb core keeps dense regions luminous instead of clipping white.
const SPRITE = 64;
const spriteCache = new Map();
function glowSprite(color) {
  let c = spriteCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const ctx = c.getContext('2d');
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const grad = ctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.24)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SPRITE, SPRITE);
  spriteCache.set(color, c);
  return c;
}

// A luminous speck drifting in the 3D volume. Brownian drift per axis. The
// volume is a CYLINDER — a circular patch of air standing on the floor plane
// (x/z = floor, y = height) — so the pulled-back view reads as a round area,
// not a box. Wraps: leaving the wall re-enters at the opposite side (at the
// antipode the same velocity points back inward), height wraps top↔bottom.
class Speck3D {
  constructor(color, radius, field, { haze = false, opacity = 1 } = {}) {
    this.color = color;
    this.radius = radius;
    this.field = field;
    this.haze = haze; // soft gas puff (few, large, dim) vs particle orb
    // Thickness of the smoke: 1 for particle orbs, and for gas haze a factor
    // from how concentrated that gas actually is (denser gas = thicker, more
    // opaque smoke). Multiplied into the haze alpha in drawSource3D.
    this.opacity = opacity;
    // sqrt() for uniform density over the disc footprint.
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * field.r;
    this.x = Math.cos(a) * rr;
    this.z = Math.sin(a) * rr;
    this.y = (Math.random() * 2 - 1) * field.ry;
    // Haze drifts slower — a dissolved cloud, not a bouncing speck.
    const speed = haze ? 0.25 : 0.6;
    this.vx = (Math.random() * 2 - 1) * speed;
    this.vy = (Math.random() * 2 - 1) * speed;
    this.vz = (Math.random() * 2 - 1) * (haze ? 0.15 : 0.4);
  }

  move(agit) {
    const { r, ry } = this.field;
    this.x += this.vx * agit + (Math.random() - 0.5) * 0.4;
    this.y += this.vy * agit + (Math.random() - 0.5) * 0.4;
    this.z += this.vz * agit;
    if (this.y > ry) this.y -= ry * 2;
    else if (this.y < -ry) this.y += ry * 2;
    const d2 = this.x * this.x + this.z * this.z;
    if (d2 > r * r) {
      const k = -(r * 0.99) / Math.sqrt(d2); // antipode, just inside the wall
      this.x *= k;
      this.z *= k;
    }
  }
}

// Inner→outer order for the breath-ring view: matches the modeled source list
// (soot → brake → haze → wildfire → bio), with ultrafine last/innermost when
// present. Same colors and shares as the "What's in this breath" bar chart.
const RING_SOURCE_ORDER = [...SOURCES.map((s) => s.key), ULTRAFINE.key];

const POLLUTANT_BY_KEY = Object.fromEntries(POLLUTANTS.map((d) => [d.key, d]));
const SOURCE_BY_KEY = Object.fromEntries(
  [...SOURCES, ULTRAFINE].map((s) => [s.key, s])
);

// Earth's clean breath by composition. Shown until a place is searched — the
// same "what's in a breath" ring language as the pollution source rings, but
// for N₂/O₂/Ar instead of soot/haze. Labels feed the hover tooltip.
const BASELINE_LAYERS = [
  { value: 78, color: '#57B36F', label: 'Nitrogen (N₂) · 78% of a clean breath' },
  { value: 21, color: '#5B8DEF', label: 'Oxygen (O₂) · 21%' },
  { value: 0.93, color: '#9AA0A6', centered: true, label: 'Argon (Ar) · 0.93%' },
  { value: 0.04, color: '#E86A6A', semiCentered: true, label: 'Carbon dioxide (CO₂) · 0.04%' },
  { value: 0.0018, color: '#E0C24A', semiCentered: true, label: 'Neon (Ne) · trace' },
  { value: 0.0262, color: '#B9AE97', semiCentered: true, label: 'Other trace gases' },
];

export function airParticleSketch(p, data) {
  const view = data?.view ?? 'baseline';
  const current = data?.current ?? null;
  const mode = data?.mode ?? 'legal';
  const hidden = data?.hidden ?? []; // source keys switched off in the legend
  const sky = data?.sky ?? null; // [top, mid, horizon] RGB stops, or null
  const is3D = (view === 'source' || view === 'pollutants') && current != null;

  let kind = 'baseline'; // 'baseline' | 'rings' | 'source'
  let organics = [];
  let zoneLabels = []; // on-canvas zone captions (breathScale only)
  let specks = []; // Speck3D[] (source view only)
  let field = null; // the 3D volume half-extents
  let change = 0;
  let pulseSpeed = BASE_PULSE_SPEED;
  let agitation = 1;
  let ground = GROUND_FALLBACK;
  let activePointers = null; // Map of live pointers (source view; pauses idle spin)
  // Our own pointer tracker for the ring views. p5 2.x's mouseX/mouseY doesn't
  // update reliably here, so the hover hit-test reads this instead — a plain
  // pointermove listener on the canvas (removed with the canvas on unmount).
  const mouse = { x: -1, y: -1 };

  // Content width of the P5Sketch mount node (p5 sets it as the canvas parent).
  // A 0 means the panel is collapsed (display:none) or not laid out yet — NOT a
  // real size, so callers must treat 0 as "don't resize" rather than falling back
  // to CANVAS_MAX (that fallback is what left the canvas 800px tall on re-expand).
  const hostWidth = () => Math.min(p.canvas?.parentElement?.clientWidth || 0, CANVAS_MAX);

  // Resize the square canvas to fit its container. Skips a 0/hidden width so a
  // resize fired while the Atmosphere panel is collapsed can't bloat it.
  const fitToHost = () => {
    const size = hostWidth();
    if (size > 0 && size !== p.width) {
      p.resizeCanvas(size, size);
      skyGradientCache = null; // gradient is sized to the canvas
      build(); // rings/baseline are canvas-relative — rebuild so radii stay inside
    }
  };

  function pulseFromAqi(c) {
    return p.constrain(p.map(c.us_aqi ?? 0, 0, 300, 0.11, 0.34), 0.11, 0.34);
  }

  // A pulsing concentric ring of crisp particles — shared by Earth's clean
  // breath (baseline) and the pollution-source breath rings. Positions are
  // fixed at spawn; the ring pulses, and a cheap sin-based wobble stands in
  // for Brownian jitter (no Math.random per particle per frame).
  class Organic {
    constructor(
      radius,
      xpos,
      ypos,
      color,
      { centered = false, semiCentered = false, band = 20, dot = 8, pulse = 20, label = null } = {}
    ) {
      this.baseRadius = radius;
      this.radius = radius;
      this.xpos = xpos;
      this.ypos = ypos;
      this.color = color;
      this.centered = centered;
      this.semiCentered = semiCentered;
      this.band = band;
      this.dot = dot;
      this.pulse = pulse;
      this.label = label;
      this.particles = [];
      // Jitter amplitude — outer rings use the band; centered/semiCentered
      // layers barely pulse, so they get a floor so the middle still wobbles.
      this.jitterAmp =
        this.centered || this.semiCentered
          ? Math.max(5.5, Math.min(this.band * 0.55, 9))
          : Math.min(this.band * 0.4, 7);
    }

    hitRadius() {
      if (this.centered) return 0;
      if (this.semiCentered) return this.radius / 5;
      return this.radius;
    }

    generateParticles(numParticles) {
      this.particles = [];
      for (let i = 0; i < numParticles; i++) {
        const angle = p.random(p.TWO_PI);
        let baseDist;
        if (this.centered) baseDist = p.random(0, this.baseRadius / 3);
        else if (this.semiCentered) baseDist = this.baseRadius / 5;
        else baseDist = this.baseRadius + p.random(-this.band, this.band);
        // Phase offsets make each speck wobble independently without random().
        this.particles.push({
          angle,
          baseDist,
          phaseR: p.random(p.TWO_PI),
          phaseA: p.random(p.TWO_PI),
        });
      }
    }

    show(changeVal) {
      const pulse = p.sin(changeVal) * this.pulse;
      this.radius = this.baseRadius + pulse;
      p.stroke(255);
      p.strokeWeight(Math.max(0.5, this.dot / 9));
      p.fill(this.color);
      const cx = this.xpos;
      const cy = this.ypos;
      const dot = this.dot;
      const jAmp = this.jitterAmp;
      // Center clusters get a stronger angular wander (they don't ride the pulse).
      const jAScale = this.centered || this.semiCentered ? 0.055 : 0.028;
      for (const particle of this.particles) {
        let distance;
        if (this.centered) distance = particle.baseDist;
        else if (this.semiCentered) distance = this.radius / 5;
        else distance = particle.baseDist + pulse;
        // Cheap organic jitter: two sins, no RNG — amp tuned for visible wobble.
        const jR = Math.sin(changeVal * 1.7 + particle.phaseR) * jAmp;
        const jA = Math.sin(changeVal * 2.1 + particle.phaseA) * jAScale;
        const a = particle.angle + jA;
        const d = distance + jR;
        p.circle(cx + p.cos(a) * d, cy + p.sin(a) * d, dot);
      }
    }
  }

  // Default / loading diagram: what's in a breath on Earth — clean air by
  // volume. Same ring language as the pollution breath rings, but tighter —
  // fewer dots need a smaller footprint so the field doesn't look sparse.
  function buildBaseline() {
    kind = 'baseline';
    organics = [];
    zoneLabels = [];
    specks = [];
    change = 0;
    pulseSpeed = BASE_PULSE_SPEED * 0.65;

    const maxR = p.width * 0.32;
    const inner = p.width * 0.04;
    const rawSteps = BASELINE_LAYERS.map((l) => Math.max(0.05, Math.sqrt(l.value / Math.PI)));
    const stepSum = rawSteps.reduce((a, b) => a + b, 0) || 1;
    const scale = (maxR - inner) / stepSum;
    const baseDot = Math.max(2.4, p.width / 85);
    let r = inner;

    BASELINE_LAYERS.forEach((layer, i) => {
      const step = rawSteps[i] * scale;
      const band = step * 0.28;
      const pulse = p.constrain(step * 0.2, 2, step * 0.45);
      const ringR = r + step;
      // Denser field than the old 10–200 map — outer N₂/O₂ rings especially,
      // with a floor so the tiny center gases still read as a swarm.
      let numParticles = Math.round(p.map(layer.value, 0, 100, 36, 360));
      if (layer.centered || layer.semiCentered) numParticles = Math.max(40, numParticles);
      const organic = new Organic(ringR, p.width / 2, p.height / 2, layer.color, {
        centered: !!layer.centered,
        semiCentered: !!layer.semiCentered,
        band,
        dot: layer.centered || layer.semiCentered ? Math.max(2.2, baseDot * 0.9) : baseDot,
        pulse,
        label: layer.label,
      });
      organic.generateParticles(numParticles);
      organics.push(organic);
      r = ringR;
    });
  }

  // The MODELED source rings for the pollution sliver — the same split as
  // BreathBars / SourceLegend. Returns concentric ring layers within [innerR,
  // outerR] around (cx, cy). Density ∝ each source's share of the PM2.5 mass;
  // ultrafine is an extra estimated swarm. Hidden legend rows drop their ring.
  // Shared by both breath views (as the "pollution" they zoom into).
  function pollutionRings(c, cx, cy, innerR, outerR, baseDot) {
    const breakdown = particleBreakdown(c, mode === 'who' ? 'who' : 'legal');
    const layers = [];
    for (const key of RING_SOURCE_ORDER) {
      if (hidden.includes(key)) continue;
      const entry = SOURCE_BY_KEY[key];
      if (!entry) continue;
      const count =
        key === ULTRAFINE.key ? breakdown.ultrafine : (breakdown.sources[key] ?? 0);
      if (count <= 0) continue;
      const pct =
        key === ULTRAFINE.key ? null : Math.round((breakdown.fractions[key] ?? 0) * 100);
      layers.push({ entry, count, pct });
    }

    const n = layers.length || 1;
    const spacing = (outerR - innerR) / n;
    const band = spacing * 0.28;
    const out = [];
    layers.forEach(({ entry, count, pct }, i) => {
      const ringRadius = innerR + spacing * (i + 0.5);
      const pulse = p.constrain(ringRadius * 0.14, 2, spacing * 0.5);
      // Map source size[] (draw radii) onto ring dots — ultrafine smallest.
      const sizeMid = (entry.size[0] + entry.size[1]) / 2;
      const dot = Math.max(2, baseDot * (sizeMid / 3.2));
      const label =
        pct != null
          ? `${entry.label} · ${pct}% of the PM2.5 mass (drawn far larger than true scale)`
          : `${entry.label} · estimated, not in the mass number`;
      const organic = new Organic(ringRadius, cx, cy, entry.color, { band, dot, pulse, label });
      // Count already tracks the source share — keep a floor so tiny % still
      // reads as a thin ring, and a ceiling so one dominant source doesn't
      // fill the canvas solid. Kept deliberately sparse: in the breath views the
      // clean-gas swarms should overwhelm this pollution core, so the pollution
      // rings get far fewer dots than the gas rings.
      organic.generateParticles(Math.round(p.constrain(count * 0.55, 8, 140)));
      out.push(organic);
    });
    return out;
  }

  // N₂/O₂/Ar as concentric rings within [innerR, outerR], sized to true ratio
  // TO EACH OTHER (area ∝ %, so the argon ring is honestly thin). Shared by both
  // breath views as "the breath" the pollution hides inside.
  function breathGasRings(cx, cy, innerR, outerR, baseDot, { labelSuffix = 'of a breath' } = {}) {
    const stepW = AIR_GASES.map((g) => Math.sqrt(g.pct));
    const stepSum = stepW.reduce((a, b) => a + b, 0) || 1;
    const out = [];
    let r = innerR;
    AIR_GASES.forEach((g, i) => {
      const step = (stepW[i] / stepSum) * (outerR - innerR);
      const ringRadius = r + step;
      const band = step * 0.3;
      const pulse = p.constrain(step * 0.18, 2, step * 0.45);
      // Dense clean-gas swarms on purpose: the whole point of the breath views
      // is how overwhelmingly N₂/O₂/Ar outnumber the pollution core, so the gas
      // rings get many more dots than the pollution ones. Floor keeps the thin
      // argon ring a real swarm.
      const num = Math.max(60, Math.round(p.map(g.pct, 0, 78, 110, 560)));
      const pctLabel = g.pct >= 1 ? `${Math.round(g.pct)}%` : `${g.pct}%`;
      const organic = new Organic(ringRadius, cx, cy, g.color, {
        band,
        dot: baseDot,
        pulse,
        label: `${g.full} (${g.short}) · ${pctLabel} ${labelSuffix}`,
      });
      organic.generateParticles(num);
      out.push(organic);
      r = ringRadius;
    });
    return out;
  }

  // breathRings view (Option A): the bulk gases as big outer rings wrapped
  // around a tiny pollution core. The core holds the WHOLE modeled source mix,
  // drawn far larger than true scale (the UI discloses this) so the <0.01%
  // pollution sliver is visible at all against the 99.99% clean gas.
  function buildBreathRings(c) {
    kind = 'rings';
    organics = [];
    zoneLabels = [];
    specks = [];
    change = 0;
    pulseSpeed = pulseFromAqi(c);

    const cx = p.width / 2;
    const cy = p.height / 2;
    const maxR = p.width * 0.36;
    const coreR = maxR * 0.22; // reserved inner disc for the exaggerated pollution
    const baseDot = Math.max(2.4, p.width / 82);

    organics.push(...breathGasRings(cx, cy, coreR, maxR, baseDot));
    organics.push(...pollutionRings(c, cx, cy, coreR * 0.12, coreR, Math.max(2, baseDot * 0.85)));
  }

  // breathScale view (Option C): two stacked zones. Top = a breath (N₂/O₂/Ar to
  // true ratio); bottom = that breath's pollution sliver, zoomed into its source
  // mix. The particle version of the two-bar BreathBars chart — the ×zoom
  // between the zones is the disclosed exaggeration.
  function buildBreathScale(c) {
    kind = 'rings';
    organics = [];
    zoneLabels = [];
    specks = [];
    change = 0;
    pulseSpeed = pulseFromAqi(c);

    const cx = p.width / 2;
    const pad = 40; // px above the top caption, and under the upper cluster
    const cap = Math.max(11, p.width / 46);
    // Size clusters to leave room for the two 40px pads + captions in a square canvas.
    const clusterR = Math.min(
      p.width * 0.15,
      (p.height - pad * 2 - cap * 2.5 - 36) / 4
    );
    // textAlign CENTER → y is the text midline; pad clears the glyph top.
    const labelY = pad + cap / 2;
    const topCy = labelY + cap / 2 + 10 + clusterR;
    const midLabelY = topCy + clusterR + pad + (cap * 0.92) / 2;
    const botCy = midLabelY + (cap * 0.92) / 2 + 12 + clusterR;
    const baseDot = Math.max(2.2, p.width / 92);

    organics.push(...breathGasRings(cx, topCy, clusterR * 0.12, clusterR, baseDot));
    organics.push(...pollutionRings(c, cx, botCy, clusterR * 0.16, clusterR, Math.max(2, baseDot * 1.1)));

    zoneLabels = [
      { text: 'A breath — 99.99% clean gas', x: cx, y: labelY, size: cap },
      { text: '↓ the pollution in it, zoomed ↓', x: cx, y: midLabelY, size: cap * 0.92 },
    ];
  }

  // Shared setup for both 3D field views: reset state, size the volume, then
  // fill it from a list of { color, size, count, haze? } groups. Every orb is
  // one drawImage per frame, so the field is capped and subsampled
  // proportionally when a heavy scenario would blow past it. Haze groups stay
  // few-by-design (soft gas puffs) and are NOT subsampled down with particles.
  function fill3DField(c, groups) {
    kind = 'source';
    organics = [];
    zoneLabels = [];
    specks = [];
    agitation = clamp(p.map(c.us_aqi ?? 0, 0, 300, 0.5, 2.5), 0.5, 2.5);
    field = { r: p.width * 0.92, ry: p.width * 0.7 };

    const MAX_SPECKS = typeof window !== 'undefined' && window.innerWidth < 700 ? 750 : 1300;
    const particleWanted = groups
      .filter((v) => !v.haze)
      .reduce((sum, v) => sum + v.count, 0);
    const keep = particleWanted > MAX_SPECKS ? MAX_SPECKS / particleWanted : 1;

    // Haze first in the array so draw order can put them behind particle orbs
    // without a second pass sort every frame.
    const ordered = [
      ...groups.filter((v) => v.haze),
      ...groups.filter((v) => !v.haze),
    ];
    for (const v of ordered) {
      const count = v.haze ? v.count : Math.round(v.count * keep);
      for (let i = 0; i < count; i++) {
        const radius = v.size[0] + Math.random() * (v.size[1] - v.size[0]);
        specks.push(new Speck3D(v.color, radius, field, { haze: !!v.haze, opacity: v.opacity ?? 1 }));
      }
    }
  }

  // Source view: one breath blown up into a 3D volume of glowing specks,
  // coloured by what they are. The legal/WHO line sets how many mass-based
  // specks appear; the ultrafine swarm is added on top, unmoved by the line.
  function buildSource(c) {
    const breakdown = particleBreakdown(c, mode);
    const groups = SOURCES.filter((s) => !hidden.includes(s.key)).map((s) => ({
      color: s.color,
      size: s.size,
      count: breakdown.sources[s.key] ?? 0,
    }));
    if (!hidden.includes(ULTRAFINE.key)) {
      groups.push({ color: ULTRAFINE.color, size: ULTRAFINE.size, count: breakdown.ultrafine });
    }
    fill3DField(c, groups);
  }

  // Pollutant field: gases as soft haze puffs, PM/dust as particle orbs.
  // Colors match POLLUTANTS / the readout list. Perf: ≤ ~40 haze blits/frame.
  // A gas's smoke gets THICKER — more puffs, bigger, more opaque — the more
  // concentrated it actually is (pollutantNorm over that gas's typical urban
  // range), so a wisp of CO reads differently from a wall of ozone.
  function buildPollutants(c) {
    const HAZE_PUFFS = typeof window !== 'undefined' && window.innerWidth < 700 ? 28 : 40;
    const abundance = pollutantAbundance(c);
    const groups = [];
    for (const a of abundance) {
      const def = POLLUTANT_BY_KEY[a.key];
      if (!def) continue;
      if (hidden.includes(a.key) || hidden.includes(def.key)) continue;
      if (a.kind === 'gas' || def.form === 'gas') {
        // 0 = barely there, ~1 = a high day for this gas. Drives puff count,
        // size and opacity together so density reads as concentration.
        const thickness = pollutantNorm(def, c[def.key] ?? 0); // 0..1.25
        const bulk = 0.6 + thickness; // 0.6 (wisp) → ~1.85 (thick)
        const share = a.kindShare ?? a.share;
        groups.push({
          color: def.color,
          size: [14 * (0.75 + thickness * 0.5), 28 * (0.75 + thickness * 0.5)],
          count: Math.max(
            share > 0.02 ? 2 : 0,
            Math.round(share * HAZE_PUFFS * (0.7 + thickness * 0.6))
          ),
          opacity: bulk,
          haze: true,
        });
      } else {
        groups.push({ color: def.color, size: a.size, count: a.count });
      }
    }
    fill3DField(c, groups);
  }

  // The sky background, cached per canvas size (a CanvasGradient is cheap to
  // build but free to reuse; invalidated on resize).
  let skyGradientCache = null;
  function paintBackground(ctx) {
    if (!sky) {
      p.background(ground[0], ground[1], ground[2]);
      return;
    }
    if (!skyGradientCache) {
      const g = ctx.createLinearGradient(0, 0, 0, p.height);
      const [top, mid, hor] = sky;
      g.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
      g.addColorStop(0.55, `rgb(${mid[0]},${mid[1]},${mid[2]})`);
      g.addColorStop(1, `rgb(${hor[0]},${hor[1]},${hor[2]})`);
      skyGradientCache = g;
    }
    ctx.fillStyle = skyGradientCache;
    ctx.fillRect(0, 0, p.width, p.height);
  }

  // Rotate the world, project each speck to the screen, blit its glow sprite.
  // The camera never moves — orbiting rotates the volume, zoom scales it — so
  // the projection stays a one-liner and additive order never matters.
  function drawSource3D() {
    const ctx = p.drawingContext;
    // p5 stamps touch-action: none on its canvas after setup runs, which would
    // trap page scrolling on touch. Re-assert pan-y (vertical swipe = page
    // scroll, horizontal drag = orbit); the check makes repeat frames free.
    if (p.canvas.style.touchAction !== 'pan-y') p.canvas.style.touchAction = 'pan-y';
    ctx.globalCompositeOperation = 'source-over';
    paintBackground(ctx);

    if (!activePointers?.size) cam.yaw += CAM.idleSpin; // gentle idle drift
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cx = Math.cos(cam.pitch);
    const sx = Math.sin(cam.pitch);
    const f = p.width * 1.2; // focal length
    const nearLimit = f * 0.15; // cull just before the eye
    const halfW = p.width / 2;
    const halfH = p.height / 2;

    ctx.globalCompositeOperation = 'lighter'; // additive: overlaps sum to light
    // Two passes keep haze behind particle orbs without sorting every speck.
    for (const passHaze of [true, false]) {
      for (const s of specks) {
        if (s.haze !== passHaze) continue;
        s.move(agitation);
        // Yaw about Y, then pitch about X.
        const x1 = s.x * cy + s.z * sy;
        const z1 = -s.x * sy + s.z * cy;
        const y1 = s.y * cx - z1 * sx;
        const z2 = (s.y * sx + z1 * cx) * cam.zoom;

        const denom = f - z2;
        if (denom < nearLimit) continue; // passed behind the eye
        const scale = f / denom;
        const px = halfW + x1 * cam.zoom * scale;
        const py = halfH + y1 * cam.zoom * scale;
        // Haze: large soft cloud; particles: small dense orb.
        const d = (s.haze ? s.radius * 5.5 : s.radius * 3.1) * scale;
        if (px + d < 0 || px - d > p.width || py + d < 0 || py - d > p.height) continue;

        const fade = clamp((denom - nearLimit) / (f * 0.1), 0, 1);
        // Nearer = brighter; haze stays dim so it reads as dissolved air, but a
        // more concentrated gas (s.opacity) makes its smoke thicker and darker.
        ctx.globalAlpha = s.haze
          ? Math.min(0.32, 0.1 * s.opacity * scale) * fade
          : Math.min(1, 0.55 * scale) * fade;
        ctx.drawImage(glowSprite(s.color), px - d / 2, py - d / 2, d, d);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Drag to orbit, wheel to zoom, pinch on touch. Wheel only fires over the
  // canvas (so the page scroll is never hijacked), and touch-action: pan-y
  // leaves vertical swipes to the browser so the canvas never traps scrolling.
  // Listeners live on the canvas element, which p5 removes on unmount.
  function initCameraControls() {
    const cv = p.canvas;
    cv.style.touchAction = 'pan-y';
    cv.style.cursor = 'grab';
    const pointers = new Map();
    activePointers = pointers;
    let pinchDist = 0;

    const setZoom = (z) => {
      cam.zoom = clamp(z, CAM.minZoom, CAM.maxZoom);
    };
    const pinch = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        setZoom(cam.zoom * Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false }
    );
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinchDist = pinch();
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        cam.yaw += (e.clientX - prev.x) * 0.005;
        cam.pitch = clamp(cam.pitch + (e.clientY - prev.y) * 0.005, -CAM.maxPitch, CAM.maxPitch);
      } else if (pointers.size === 2 && pinchDist > 0) {
        const d = pinch();
        setZoom(cam.zoom * (d / pinchDist));
        pinchDist = d;
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      if (!pointers.size) cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
  }

  function build() {
    if (is3D) {
      if (view === 'pollutants') buildPollutants(current);
      else buildSource(current);
    } else if (view === 'breathRings' && current) buildBreathRings(current);
    else if (view === 'breathScale' && current) buildBreathScale(current);
    else buildBaseline();
  }

  // Which ring (if any) is under the cursor. Rings are concentric around each
  // organic's own centre (breathScale stacks two centres), so the test is
  // |mouse distance from that centre − ring radius| within the particle band.
  function hoveredRing() {
    const mx = mouse.x;
    const my = mouse.y;
    if (mx < 0 || mx > p.width || my < 0 || my > p.height) return null;
    let best = null;
    let bestErr = Infinity;
    for (const o of organics) {
      if (!o.label) continue;
      const d = Math.hypot(mx - o.xpos, my - o.ypos);
      const tol = o.centered ? o.radius / 3 + o.dot : o.band + o.dot;
      const err = Math.abs(d - o.hitRadius());
      if (err <= tol && err < bestErr) {
        best = o;
        bestErr = err;
      }
    }
    return best;
  }

  // A small in-canvas tooltip naming the hovered ring's particle class. Drawn
  // on the canvas (not DOM) so it costs nothing when nothing is hovered.
  function drawRingTooltip(ring) {
    const size = Math.max(11, p.width / 42);
    p.push();
    p.textSize(size);
    p.textAlign(p.LEFT, p.CENTER);
    const pad = 7;
    const dotSpan = size * 0.8; // the colour swatch before the text
    const w = p.textWidth(ring.label) + dotSpan + pad * 2;
    const h = size + pad * 1.6;
    // Beside the cursor, clamped inside the canvas.
    const x = Math.min(Math.max(mouse.x + 14, 4), p.width - w - 4);
    const y = Math.min(Math.max(mouse.y - h - 10, 4), p.height - h - 4);
    p.stroke(74, 68, 60); // --hairline-strong
    p.strokeWeight(1);
    p.fill(31, 28, 25, 235); // --ground, near-opaque
    p.rect(x, y, w, h, 4);
    p.noStroke();
    p.fill(ring.color);
    p.circle(x + pad, y + h / 2, size * 0.55);
    p.fill(246, 239, 224); // --sand-bright
    p.text(ring.label, x + pad + size * 0.7, y + h / 2);
    p.pop();
  }

  p.setup = () => {
    p.createCanvas(10, 10); // mount first so the parent is measurable
    // Perf: one device pixel per CSS pixel (skip the retina multiplier). The
    // crisp ring views only pulse gently, so 30fps; the 3D field runs at 60
    // for smooth orbiting — its frame is cheap (raw drawImage blits).
    p.pixelDensity(1);
    // Rings only pulse — 24fps is plenty. 3D needs 60 for orbit smoothness.
    p.frameRate(is3D ? 60 : 24);
    ground = groundColor();
    // Fall back to CANVAS_MAX for the FIRST paint only — some hosts (and this
    // preview harness) report a 0 width before first layout. The ResizeObserver
    // below corrects it the moment the container reports a real width.
    const size = hostWidth() || CANVAS_MAX;
    p.resizeCanvas(size, size);
    build();
    // Re-fit whenever the container's size actually changes. Crucially, the
    // Atmosphere panel collapsing/expanding resizes the mount with NO window
    // 'resize' event, so windowResized() alone missed it — the canvas stayed at
    // the 800px fallback and re-expanded far too tall. Disconnect on teardown.
    if (typeof ResizeObserver !== 'undefined' && p.canvas?.parentElement) {
      const ro = new ResizeObserver(() => fitToHost());
      ro.observe(p.canvas.parentElement);
      const removeInstance = p.remove.bind(p);
      p.remove = () => {
        ro.disconnect();
        removeInstance();
      };
    }
    if (is3D) initCameraControls();
    else {
      // Ring/baseline views: track the pointer for the hover hit-test, and
      // force a synchronous redraw on each move. Redrawing on the event (rather
      // than waiting for the next draw frame) makes the hover isolate instant
      // AND keeps it working even when the rAF loop is throttled (e.g. a
      // backgrounded tab, or this preview harness).
      const cv = p.canvas;
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        // Canvas pixels == CSS pixels (pixelDensity(1), no CSS scaling beyond
        // max-width:100%, which rect.width accounts for).
        mouse.x = ((e.clientX - r.left) / r.width) * p.width;
        mouse.y = ((e.clientY - r.top) / r.height) * p.height;
        p.redraw();
      });
      cv.addEventListener('pointerleave', () => {
        mouse.x = -1;
        mouse.y = -1;
        p.redraw();
      });
    }
  };

  p.windowResized = () => fitToHost();

  p.draw = () => {
    if (kind === 'source') {
      drawSource3D();
    } else {
      p.background(ground[0], ground[1], ground[2]);
      // Hover isolates a ring: every OTHER ring's particles drop to low alpha
      // so the hovered pollutant reads as its own layer, not part of a blur.
      const hovered = hoveredRing();
      const ctx = p.drawingContext;
      // Crisp rings: outer layers first so the dense centre draws on top.
      for (let i = organics.length - 1; i >= 0; i--) {
        ctx.globalAlpha = hovered && organics[i] !== hovered ? 0.14 : 1;
        organics[i].show(change);
      }
      ctx.globalAlpha = 1;
      // Zone captions (breathScale): drawn over the fields so the two stacked
      // clusters read as "a breath" and "its pollution, zoomed".
      if (zoneLabels.length) {
        p.push();
        p.noStroke();
        p.textAlign(p.CENTER, p.CENTER);
        for (const zl of zoneLabels) {
          p.textSize(zl.size);
          p.fill(198, 190, 174); // --sand-muted, quiet against the fields
          p.text(zl.text, zl.x, zl.y);
        }
        p.pop();
      }
      change += pulseSpeed;
      p.canvas.style.cursor = hovered ? 'crosshair' : 'default';
      if (hovered) drawRingTooltip(hovered);
    }
  };
}
