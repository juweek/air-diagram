import { POLLUTANTS, exceedance } from '../lib/pollutants.js';
import { SOURCES, ULTRAFINE, particleBreakdown } from '../lib/composition.js';

/**
 * The air-particle diagram, as a pure p5 sketch: airParticleSketch(p, data).
 * No global mode, no controller — P5Sketch.jsx owns mount/teardown and re-runs
 * this whenever `data` changes. `data = { current, view, mode, hidden }`:
 *   view: 'baseline' | 'source' | 'rings'   (baseline = Earth's atmosphere)
 *   mode: 'legal' | 'who'                    (which reference line)
 *   current: the Open-Meteo `current` readings (null in baseline view)
 *
 * RENDERING (Style-2 charcoal): two deliberately different languages —
 *
 *   • The "by source" field is a 3D VOLUME of luminous orbs. Specks live in a
 *     box of 3D positions; each frame we rotate the world (orbit), perspective-
 *     project to 2D ourselves, and blit a cached radial-glow sprite with
 *     additive compositing. Doing the projection in ~15 lines of JS and drawing
 *     with raw ctx.drawImage keeps it fast — no per-draw p5 overhead, no
 *     tint() (which re-renders the sprite through a temp canvas every call and
 *     was the old frame-rate killer), no WebGL pipeline to maintain.
 *     Interaction: drag to orbit, wheel to zoom (only over the canvas), pinch
 *     on touch; vertical swipes still scroll the page (touch-action: pan-y).
 *
 *   • The baseline atmosphere and the pollutant rings are CRISP: plain
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
// minZoom is tied to the field size below: at 0.7× the volume's half-width
// (0.7 × canvas) still projects past the frame edge, so zooming all the way
// out never reveals empty space around the simulation.
const CAM = { minZoom: 0.7, maxZoom: 3, maxPitch: 1.25, idleSpin: 0.0012 };

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

// A luminous speck drifting in the 3D volume. Brownian drift per axis; wraps
// at the walls so the field reads as continuous while you travel through it.
class Speck3D {
  constructor(color, radius, field) {
    this.color = color;
    this.radius = radius;
    this.field = field;
    this.x = (Math.random() * 2 - 1) * field.rx;
    this.y = (Math.random() * 2 - 1) * field.ry;
    this.z = (Math.random() * 2 - 1) * field.rz;
    this.vx = (Math.random() * 2 - 1) * 0.6;
    this.vy = (Math.random() * 2 - 1) * 0.6;
    this.vz = (Math.random() * 2 - 1) * 0.4;
  }

  move(agit) {
    const { rx, ry, rz } = this.field;
    this.x += this.vx * agit + (Math.random() - 0.5) * 0.4;
    this.y += this.vy * agit + (Math.random() - 0.5) * 0.4;
    this.z += this.vz * agit;
    if (this.x > rx) this.x -= rx * 2;
    else if (this.x < -rx) this.x += rx * 2;
    if (this.y > ry) this.y -= ry * 2;
    else if (this.y < -ry) this.y += ry * 2;
    if (this.z > rz) this.z -= rz * 2;
    else if (this.z < -rz) this.z += rz * 2;
  }
}

// Inner→outer order for the pollutant-ring view: from the most-local/heaviest
// particle (dust) out to the headline fine particles.
const RING_ORDER = [
  'dust',
  'carbon_monoxide',
  'sulphur_dioxide',
  'nitrogen_dioxide',
  'ozone',
  'pm10',
  'pm2_5',
];

const POLLUTANT_BY_KEY = Object.fromEntries(POLLUTANTS.map((d) => [d.key, d]));

// Earth's atmosphere by composition. Shown until a place is searched.
// Labels feed the hover tooltip, same as the pollutant rings.
const BASELINE_LAYERS = [
  { value: 78, color: '#D45D9E', label: 'Nitrogen (N₂) · 78% of clean air' },
  { value: 21, color: '#5B6BE8', label: 'Oxygen (O₂) · 21%' },
  { value: 0.93, color: '#38C46A', centered: true, label: 'Argon (Ar) · 0.93%' },
  { value: 0.04, color: '#E86A6A', semiCentered: true, label: 'Carbon dioxide (CO₂) · 0.04%' },
  { value: 0.0018, color: '#E0C24A', semiCentered: true, label: 'Neon (Ne) · trace' },
  { value: 0.0262, color: '#B9AE97', semiCentered: true, label: 'Other trace gases' },
];

export function airParticleSketch(p, data) {
  const view = data?.view ?? 'baseline';
  const current = data?.current ?? null;
  const mode = data?.mode ?? 'legal';
  const hidden = data?.hidden ?? []; // source keys switched off in the legend
  const is3D = view === 'source' && current != null;

  let kind = 'baseline'; // 'baseline' | 'rings' | 'source'
  let organics = [];
  let specks = []; // Speck3D[] (source view only)
  let field = null; // the 3D volume half-extents
  let change = 0;
  let pulseSpeed = BASE_PULSE_SPEED;
  let agitation = 1;
  let ground = GROUND_FALLBACK;
  let activePointers = null; // Map of live pointers (source view; pauses idle spin)

  // Size to the P5Sketch mount node (which p5 sets as the canvas parent).
  const hostWidth = () => Math.min(p.canvas?.parentElement?.clientWidth || CANVAS_MAX, CANVAS_MAX);

  function pulseFromAqi(c) {
    return p.constrain(p.map(c.us_aqi ?? 0, 0, 300, 0.11, 0.34), 0.11, 0.34);
  }

  // A pulsing concentric ring of crisp particles — the original diagram's
  // building block, used by the baseline and the pollutant-ring view.
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
      this.label = label; // shown by the hover tooltip
      this.particles = [];
    }

    // Where this ring's particles actually sit (centered layers cluster at the
    // middle; semiCentered at radius/5) — used by the hover hit-test.
    hitRadius() {
      if (this.centered) return 0;
      if (this.semiCentered) return this.radius / 5;
      return this.radius;
    }

    ringDistance() {
      if (this.centered) return p.random(0, this.radius / 10);
      if (this.semiCentered) return this.radius / 5;
      return this.radius + p.random(-this.band, this.band);
    }

    generateParticles(numParticles) {
      for (let i = 0; i < numParticles; i++) {
        const angle = p.random(p.TWO_PI);
        let distance;
        if (this.centered) distance = p.random(0, this.radius / 3);
        else if (this.semiCentered) distance = this.radius / 5;
        else distance = this.radius + p.random(-this.band, this.band);
        this.particles.push({
          x: this.xpos + p.cos(angle) * distance,
          y: this.ypos + p.sin(angle) * distance,
          angle,
          distance,
        });
      }
    }

    show(changeVal) {
      this.radius = this.baseRadius + p.sin(changeVal) * this.pulse;
      // Crisp dots: a thin white outline makes each particle read distinctly
      // against the charcoal ground (the original diagram's clarity).
      p.stroke(255);
      p.strokeWeight(Math.max(0.5, this.dot / 9));
      p.fill(this.color);
      const jitter = Math.min(this.band * 0.25, 5);
      for (const particle of this.particles) {
        const distance = this.ringDistance();
        particle.x = this.xpos + p.cos(particle.angle) * distance + p.random(-jitter, jitter);
        particle.y = this.ypos + p.sin(particle.angle) * distance + p.random(-jitter, jitter);
        p.ellipse(particle.x, particle.y, this.dot);
      }
    }
  }

  function addRing(step, startRadius, color, opts, numParticles) {
    const r = startRadius + step;
    const organic = new Organic(r, p.width / 2, p.height / 2, color, opts);
    organic.generateParticles(numParticles);
    organics.push(organic);
    return r;
  }

  function buildBaseline() {
    kind = 'baseline';
    organics = [];
    specks = [];
    change = 0;
    pulseSpeed = BASE_PULSE_SPEED;
    let r = 50;
    for (const layer of BASELINE_LAYERS) {
      const numParticles = p.map(layer.value, 0, 100, 0, 5000);
      const step = Math.max(24, p.sqrt(layer.value / p.PI) * 10);
      r = addRing(step, r, layer.color, layer, numParticles);
    }
  }

  // Pollutant-ring view: one concentric ring per pollutant, its DENSITY (not
  // radius) riding how far the reading sits over the active line. Everything is
  // canvas-relative so the rings stay inside the small stacked canvases.
  function buildRings(c) {
    kind = 'rings';
    organics = [];
    specks = [];
    change = 0;
    pulseSpeed = pulseFromAqi(c);

    const present = RING_ORDER.map((key) => POLLUTANT_BY_KEY[key]).filter(
      (def) => c[def.key] != null
    );
    const n = present.length || 1;

    const maxR = p.width * 0.42;
    const spacing = maxR / n;
    const band = spacing * 0.26;
    const dot = Math.max(3.5, p.width / 65);
    const innerR = spacing * 0.5;

    present.forEach((def, i) => {
      const exc = p.constrain(exceedance(def, c[def.key], mode), 0, 3);
      const numParticles = Math.round(18 + exc * 200);
      const ringRadius = innerR + spacing * i;
      const pulse = p.constrain(ringRadius * 0.16, 3, spacing * 0.55);
      const organic = new Organic(ringRadius, p.width / 2, p.height / 2, def.color, {
        band,
        dot,
        pulse,
        label: `${def.label} · ${def.name}`,
      });
      organic.generateParticles(numParticles);
      organics.push(organic);
    });
  }

  // Source view: one breath blown up into a 3D volume of glowing specks,
  // coloured by what they are. The legal/WHO line sets how many mass-based
  // specks appear; the ultrafine swarm is added on top, unmoved by the line.
  function buildSource(c) {
    kind = 'source';
    organics = [];
    specks = [];
    agitation = clamp(p.map(c.us_aqi ?? 0, 0, 300, 0.5, 2.5), 0.5, 2.5);

    // The volume, sized to the canvas but deliberately OVERSIZED (the canvas
    // frames a window into it): even fully zoomed out (CAM.minZoom) the box
    // still overfills the frame, so you always feel inside the simulation.
    // z stays shallower than x/y so it reads as a cloud, not a tunnel.
    field = { rx: p.width * 0.7, ry: p.width * 0.65, rz: p.width * 0.45 };

    const breakdown = particleBreakdown(c, mode);

    // Every orb is one drawImage per frame, so cap the field and subsample
    // proportionally when a heavy scenario (cigarette, wildfire) would blow
    // past it — a dense field still reads dense, and the frame stays smooth.
    // Slightly higher than before the volume grew, so the bigger box keeps a
    // comparable density without blowing the frame budget.
    const MAX_SPECKS = typeof window !== 'undefined' && window.innerWidth < 700 ? 1000 : 1800;
    const visible = SOURCES.filter((s) => !hidden.includes(s.key)).map((s) => ({
      color: s.color,
      size: s.size,
      count: breakdown.sources[s.key] ?? 0,
    }));
    if (!hidden.includes(ULTRAFINE.key)) {
      visible.push({ color: ULTRAFINE.color, size: ULTRAFINE.size, count: breakdown.ultrafine });
    }
    const wanted = visible.reduce((sum, v) => sum + v.count, 0);
    const keep = wanted > MAX_SPECKS ? MAX_SPECKS / wanted : 1;

    for (const v of visible) {
      const count = Math.round(v.count * keep);
      for (let i = 0; i < count; i++) {
        const radius = v.size[0] + Math.random() * (v.size[1] - v.size[0]);
        specks.push(new Speck3D(v.color, radius, field));
      }
    }
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
    p.background(ground[0], ground[1], ground[2]);

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
    for (const s of specks) {
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
      const d = s.radius * 5 * scale;
      if (px + d < 0 || px - d > p.width || py + d < 0 || py - d > p.height) continue;

      // Nearer = brighter; fade out approaching the near cull so orbs never pop.
      ctx.globalAlpha = Math.min(1, 0.55 * scale) * clamp((denom - nearLimit) / (f * 0.1), 0, 1);
      ctx.drawImage(glowSprite(s.color), px - d / 2, py - d / 2, d, d);
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
    if (is3D) buildSource(current);
    else if (view === 'rings' && current) buildRings(current);
    else buildBaseline();
  }

  // Which ring (if any) is under the cursor. Rings are concentric around the
  // canvas centre, so the test is just |mouse distance − ring radius| within
  // the ring's particle band.
  function hoveredRing() {
    const mx = p.mouseX;
    const my = p.mouseY;
    // p5 reports (0,0) until the pointer first moves over the canvas.
    if ((mx === 0 && my === 0) || mx < 0 || mx > p.width || my < 0 || my > p.height) return null;
    const d = Math.hypot(mx - p.width / 2, my - p.height / 2);
    let best = null;
    let bestErr = Infinity;
    for (const o of organics) {
      if (!o.label) continue;
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
    const x = Math.min(Math.max(p.mouseX + 14, 4), p.width - w - 4);
    const y = Math.min(Math.max(p.mouseY - h - 10, 4), p.height - h - 4);
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
    p.frameRate(is3D ? 60 : 30);
    ground = groundColor();
    const size = hostWidth();
    p.resizeCanvas(size, size);
    build();
    if (is3D) initCameraControls();
  };

  p.windowResized = () => {
    const size = hostWidth();
    if (size !== p.width) {
      p.resizeCanvas(size, size);
      if (is3D) {
        buildSource(current); // re-size the volume to the new canvas
      } else {
        for (const organic of organics) {
          organic.xpos = p.width / 2;
          organic.ypos = p.height / 2;
        }
      }
    }
  };

  p.draw = () => {
    if (kind === 'source') {
      drawSource3D();
    } else {
      p.background(ground[0], ground[1], ground[2]);
      // Crisp rings: outer layers first so the dense centre draws on top.
      for (let i = organics.length - 1; i >= 0; i--) organics[i].show(change);
      change += pulseSpeed;
      const hovered = hoveredRing();
      p.canvas.style.cursor = hovered ? 'crosshair' : 'default';
      if (hovered) drawRingTooltip(hovered);
    }
  };
}
