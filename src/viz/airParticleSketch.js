import { POLLUTANTS, exceedance } from '../lib/pollutants.js';
import { SOURCES, ULTRAFINE, particleBreakdown } from '../lib/composition.js';

/**
 * The air-particle diagram, as a pure p5 sketch: airParticleSketch(p, data).
 * No global mode, no controller — P5Sketch.jsx owns mount/teardown and re-runs
 * this whenever `data` changes. `data = { current, view, mode }`:
 *   view: 'baseline' | 'source' | 'rings'   (baseline = Earth's atmosphere)
 *   mode: 'legal' | 'who'                    (which reference line)
 *   current: the Open-Meteo `current` readings (null in baseline view)
 *
 * Because build{Baseline,Rings,Source} rebuild the particle set from scratch,
 * a full remount on a view/mode toggle is behaviorally identical to the old
 * controller.render() — see the migration notes.
 */

const BG = '#F7F0EF'; // brand cream (matches tailwind.config.js `cream`)
const CANVAS_MAX = 800;
const BASE_PULSE_SPEED = 0.1;

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

// The original diagram: Earth's atmosphere by composition. Shown until a
// place is searched, and again when the view is reset.
const BASELINE_LAYERS = [
  { value: 78, color: '#D45D9E6D' }, // N2
  { value: 21, color: '#221DD76D' }, // O2
  { value: 0.93, color: '#08A0108E', centered: true }, // Ar
  { value: 0.04, color: '#E41919D8', semiCentered: true }, // CO2
  { value: 0.0018, color: '#BD9B18', semiCentered: true }, // Ne
  { value: 0.0262, color: '#2A2A28F2', semiCentered: true }, // Other
];

// A speck in the scattered source view. Drifts with a little Brownian jitter
// and bounces off the canvas edges; the drift speed rises with agitation.
class Speck {
  constructor(p, color, radius) {
    this.p = p;
    this.color = color;
    this.radius = radius;
    this.x = p.random(p.width);
    this.y = p.random(p.height);
    this.vx = p.random(-1, 1);
    this.vy = p.random(-1, 1);
  }

  show(agitation) {
    const { p } = this;
    this.x += this.vx * agitation + p.random(-0.6, 0.6);
    this.y += this.vy * agitation + p.random(-0.6, 0.6);
    if (this.x < 0 || this.x > p.width) this.vx *= -1;
    if (this.y < 0 || this.y > p.height) this.vy *= -1;
    this.x = p.constrain(this.x, 0, p.width);
    this.y = p.constrain(this.y, 0, p.height);
    p.noStroke();
    p.fill(this.color);
    p.ellipse(this.x, this.y, this.radius);
  }
}

// A pulsing concentric ring of particles (the original diagram's building
// block) used by the baseline and the pollutant-ring view.
class Organic {
  // `band` = how far particles scatter either side of the ring, `dot` = draw
  // size, `pulse` = breathing amplitude. They default to the baseline diagram's
  // original values; the pollutant-ring view passes smaller, canvas-relative
  // ones so tight rings stay inside a small canvas instead of spilling off it.
  constructor(
    p,
    radius,
    xpos,
    ypos,
    color,
    { centered = false, semiCentered = false, band = 20, dot = 8, pulse = 20 } = {}
  ) {
    this.p = p;
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
    this.particles = [];
  }

  ringDistance() {
    const { p } = this;
    if (this.centered) return p.random(0, this.radius / 10);
    if (this.semiCentered) return this.radius / 5;
    return this.radius + p.random(-this.band, this.band);
  }

  generateParticles(numParticles) {
    const { p } = this;
    for (let i = 0; i < numParticles; i++) {
      const angle = p.random(p.TWO_PI);
      let distance;
      if (this.centered) {
        distance = p.random(0, this.radius / 3);
      } else if (this.semiCentered) {
        distance = this.radius / 5;
      } else {
        distance = this.radius + p.random(-this.band, this.band);
      }
      // Seed each particle at its true on-ring position so the first frame
      // already draws a full circle.
      this.particles.push({
        x: this.xpos + p.cos(angle) * distance,
        y: this.ypos + p.sin(angle) * distance,
        angle,
        distance,
      });
    }
  }

  show(change) {
    const { p } = this;
    this.radius = this.baseRadius + p.sin(change) * this.pulse;
    p.stroke(255);
    p.strokeWeight(Math.max(0.5, this.dot / 9));
    p.fill(this.color);
    const jitter = Math.min(this.band * 0.25, 5); // in-band wobble, scaled to the ring
    for (const particle of this.particles) {
      // Place each particle from its fixed stored angle around the CURRENT
      // center — a full circle on frame one, and resize-safe.
      const distance = this.ringDistance();
      particle.x = this.xpos + p.cos(particle.angle) * distance + p.random(-jitter, jitter);
      particle.y = this.ypos + p.sin(particle.angle) * distance + p.random(-jitter, jitter);
      p.ellipse(particle.x, particle.y, this.dot);
    }
  }
}

export function airParticleSketch(p, data) {
  const view = data?.view ?? 'baseline';
  const current = data?.current ?? null;
  const mode = data?.mode ?? 'legal';
  const hidden = data?.hidden ?? []; // source keys switched off in the legend

  let kind = 'baseline'; // 'baseline' | 'rings' | 'source'
  let organics = [];
  let specks = [];
  let change = 0;
  let pulseSpeed = BASE_PULSE_SPEED;
  let agitation = 1;

  // Size to the P5Sketch mount node (which p5 sets as the canvas parent), not
  // the window — the sketch lives inside a GourmetMediaContainer graphArea.
  const hostWidth = () => Math.min(p.canvas?.parentElement?.clientWidth || CANVAS_MAX, CANVAS_MAX);

  function pulseFromAqi(c) {
    // Floor raised so even a low-AQI county still visibly *breathes* (the rings
    // used to go nearly static on clean days, which read as "not a breath").
    return p.constrain(p.map(c.us_aqi ?? 0, 0, 300, 0.11, 0.34), 0.11, 0.34);
  }

  function addRing(step, startRadius, color, opts, numParticles) {
    const r = startRadius + step;
    const organic = new Organic(p, r, p.width / 2, p.height / 2, color, opts);
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

  // Pollutant-ring view: one evenly-spaced concentric ring per pollutant, its
  // particle DENSITY (not its radius) riding how far the reading sits over the
  // active line. Radii, band, pulse and dot size are all canvas-relative so the
  // whole diagram fits inside the small stacked canvases without spilling off.
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

    const maxR = p.width * 0.42; // keep the outermost ring (at pulse peak) inside
    const spacing = maxR / n;
    const band = spacing * 0.26; // half-thickness of each ring's particle band
    const dot = Math.max(3.5, p.width / 65); // particle size scales with canvas
    const innerR = spacing * 0.5; // small hole in the middle

    present.forEach((def, i) => {
      const exc = p.constrain(exceedance(def, c[def.key], mode), 0, 3);
      // Two canvases (WHO + legal) render at once, so keep each ring light.
      const numParticles = Math.round(18 + exc * 200);
      const ringRadius = innerR + spacing * i;
      // Breathe proportionally to each ring's OWN radius (like the baseline
      // atmosphere), so every ring swells by the same visible fraction and the
      // whole diagram reads as one lung — not the near-flat pulse it had before.
      // Clamped so the tiny inner ring still moves and the outer ring can't spill.
      const pulse = p.constrain(ringRadius * 0.16, 3, spacing * 0.55);
      const organic = new Organic(p, ringRadius, p.width / 2, p.height / 2, def.color, {
        band,
        dot,
        pulse,
      });
      organic.generateParticles(numParticles);
      organics.push(organic);
    });
  }

  // Source view: one breath blown up into a scattered field of specks, colored
  // by what they are. The legal/WHO line sets how many mass-based specks appear;
  // the ultrafine swarm is added on top, unmoved by the line.
  function buildSource(c) {
    kind = 'source';
    organics = [];
    specks = [];
    change = 0;
    pulseSpeed = pulseFromAqi(c);
    agitation = p.constrain(p.map(c.us_aqi ?? 0, 0, 300, 0.5, 3), 0.5, 3);

    const breakdown = particleBreakdown(c, mode);
    for (const src of SOURCES) {
      if (hidden.includes(src.key)) continue; // switched off in the legend
      const count = breakdown.sources[src.key] ?? 0;
      for (let i = 0; i < count; i++) {
        specks.push(new Speck(p, src.color, p.random(src.size[0], src.size[1])));
      }
    }
    if (!hidden.includes(ULTRAFINE.key)) {
      for (let i = 0; i < breakdown.ultrafine; i++) {
        specks.push(new Speck(p, ULTRAFINE.color, p.random(ULTRAFINE.size[0], ULTRAFINE.size[1])));
      }
    }
  }

  function build() {
    // No readings yet (or explicit baseline) → the atmosphere diagram.
    if (view === 'baseline' || !current) buildBaseline();
    else if (view === 'rings') buildRings(current);
    else buildSource(current);
  }

  p.setup = () => {
    p.createCanvas(10, 10); // mount first so the parent is measurable
    // Performance: render one device pixel per CSS pixel (skip the 2×–3× retina
    // multiplier — a huge fill-rate saving with thousands of specks) and cap the
    // loop at 30fps. The fields only drift/pulse gently, so 30 looks the same
    // and halves the per-frame draw cost. Together these let the source view
    // carry many more particles without the previous slowdown.
    p.pixelDensity(1);
    p.frameRate(30);
    const size = hostWidth();
    p.resizeCanvas(size, size);
    build();
  };

  p.windowResized = () => {
    const size = hostWidth();
    if (size !== p.width) {
      p.resizeCanvas(size, size);
      for (const organic of organics) {
        organic.xpos = p.width / 2;
        organic.ypos = p.height / 2;
      }
    }
  };

  p.draw = () => {
    p.background(BG);
    if (kind === 'source') {
      for (const speck of specks) speck.show(agitation);
    } else {
      // Outer rings first so the dense center layers draw on top.
      for (let i = organics.length - 1; i >= 0; i--) organics[i].show(change);
      change += pulseSpeed;
    }
  };
}
