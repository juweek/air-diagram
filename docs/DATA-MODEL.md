# What's in the Air — how the visualization maps to data

This doc traces **every visible element back to the value that drives it**, and
says plainly which values are **measured**, which are a **live model estimate**,
which are **modeled by us**, and which are **fixed constants or pure decoration**.

That distinction is the whole ethic of the piece: the official green "Good" badge
is a single mass number that hides what's actually in a breath, so we must never
let a *modeled* figure read as a *measurement*.

---

## Provenance tags used below

| Tag | Meaning | Example |
|---|---|---|
| **`MEASURED`** | A real instrument reading from a regulatory monitor. | AirNow PM2.5 at the nearest reporting area |
| **`LIVE MODEL`** | Today's value, but from an atmospheric **model** interpolated to your lat/lon (Open-Meteo's CAMS output, ~11 km grid) — real-time, *not* measured at your point. | The per-pollutant concentrations |
| **`MODELED BY US`** | A second layer we compute *on top of* the live values — an illustration, not data. | The source split, the ultrafine swarm |
| **`ILLUSTRATIVE`** | A canned literature figure, not tied to a place or a moment. | The `/cigarette` scenario, the typical-annual fallback |
| **`FIXED`** | A constant that never changes with the data. | The WHO / US legal lines, the baseline atmosphere |
| **`DECORATIVE`** | Carries **no** value — layout or motion only. | Particle positions, glow, ring radius, pulse |

> **The single most important rule:** particle **counts** are *rendering density*
> (scaled by screen size and capped for performance), never a literal quantity.
> Where a count would read as data, we show a **percentage** or a **×-multiple**
> instead. See [composition.js](../src/lib/composition.js) `densityScale()` and the
> `MAX_SPECKS` cap in [airParticleSketch.js](../src/viz/airParticleSketch.js).

---

## 1. The data pipeline — where the numbers come from

Everything flows through one function: `getByQuery(query)` in
[src/data/airQuality.js](../src/data/airQuality.js).

```
getByQuery("Detroit")
  ├─ getScenario()      → if the query is a preset (/cigarette), short-circuit  … ILLUSTRATIVE
  ├─ geocode()          → ZIP or city → lat/lon (Zippopotam / Nominatim / Open-Meteo)
  ├─ fetchAirQuality()  → Open-Meteo CAMS model: current + hourly PM2.5          … LIVE MODEL
  │     └─ nowcastAqi() → our 12-hr weighted PM2.5 → AQI                          … LIVE MODEL (derived)
  ├─ fetchMeasured()    → AirNow monitor reading via /api/airnow proxy           … MEASURED (or null)
  └─ nearestMonitor()   → distance to the closest regulatory PM2.5 monitor       … FIXED reference data
```

The result object handed to the page:

```js
{ location, current, nowcast, measured?, monitor?, fallback?, blurb?, source? }
```

**Three tiers of headline truth, in priority order:**

1. **`measured`** exists (a monitor is near) → the headline is a **real reading**.
2. Otherwise the **`current`** CAMS model output drives everything → **live model**.
3. If the model API fails → **`fallback`**: the nearest monitor's **typical 2024
   annual-average** PM2.5 — an `ILLUSTRATIVE` stand-in, flagged in the UI as "not
   today's reading."

Scenarios (`/cigarette`, `/wildfire`, …) never touch the network — they inject a
hand-authored `current` shaped exactly like the API's, so every visualization
works identically. Their values are `ILLUSTRATIVE` (typical published figures),
see [src/data/scenarios.js](../src/data/scenarios.js).

---

## 2. The headline number + odometer gauge

Component: `AqiMeter` / `headlineAqi()` in
[src/pages/AirPage.jsx](../src/pages/AirPage.jsx).

| What you see | Driven by | Provenance |
|---|---|---|
| The big AQI number + category word ("62 · Moderate") | `measured.aqi` **if a monitor is near**, else `max(per-pollutant model AQIs, our NowCast AQI)` | **`MEASURED`** or **`LIVE MODEL`** |
| The needle angle on the 0–500 arc | Same AQI value, linearly mapped to the arc | same as above |
| The six colored bands (Good→Hazardous) | Fixed EPA AQI category breakpoints | **`FIXED`** |
| `MEASURED` badge + "real reading from the … reporting area (20 mi away)" | AirNow observation + haversine distance | **`MEASURED`** |
| "the CAMS model reads 59 for comparison" | The live model AQI, shown *beside* the measurement so the gap is visible | **`LIVE MODEL`** |
| "typical annual average … not today's reading" note | The 2024 annual-average fallback | **`ILLUSTRATIVE`** |
| "nearest regulatory monitor: 3 mi away …" | `nearestMonitor()` compiled EPA station list | **`FIXED`** reference |

**NowCast** ([src/lib/nowcast.js](../src/lib/nowcast.js)) is the 12-hour weighted
PM2.5 average AirNow-style apps show. We compute it ourselves from the live model's
hourly PM2.5 — so it's `LIVE MODEL` (derived), not an instrument reading.

---

## 3. "By pollutant" view — the ring diagram + the bar charts

This view shows the **six pollutants regulators measure directly**, each a real
concentration. Source: `current[def.key]` — the **`LIVE MODEL`** value (or the
scenario literal). Definitions & reference lines: [src/lib/pollutants.js](../src/lib/pollutants.js).

### The rings ([airParticleSketch.js](../src/viz/airParticleSketch.js) `buildRings`)

| Ring property | Driven by | Provenance |
|---|---|---|
| **Which rings appear** | Which pollutants have a non-null reading | **`LIVE MODEL`** |
| **Ring density** (particle count `18 + exceedance×200`) | `exceedance = concentration ÷ line`, clamped 0–3 | value = **`LIVE MODEL`**; the line is **`FIXED`** |
| **Ring color** | Fixed per-pollutant hue (`POLLUTANTS[].color`) — same hex the bars & tooltip use | **`FIXED`** |
| **Ring radius / order** | Layout only (dust innermost → PM2.5 outermost), canvas-relative | **`DECORATIVE`** — radius is *not* a value |
| **Pulse (breathing) speed** | Mapped from AQI (calm when clean, agitated when dirty) | **`LIVE MODEL`** (aesthetic) |
| **Hover tooltip text** | The pollutant's fixed label + name | **`FIXED`** |

Two ring canvases stack — **WHO health line** (stricter → denser) above **US legal
line** (looser → sparser). *Same air, judged by two yardsticks.* The only thing the
toggle changes is which `FIXED` line the same `LIVE MODEL` reading is measured
against.

### The bar charts (`MiniLine`)

Each pollutant gets **two bars**: `reading ÷ WHO` and `reading ÷ US legal`.

- Bar **fill** = `min(ratio, 1)` → a full bar means "at or past that line."
- Number at right = the exact `ratio×` (e.g. `3.9×`).
- Bar **color** = the pollutant's own hue (matches the ring). *(As of the latest
  pass, over-limit bars keep their color — they no longer flip to red.)*

Reading = **`LIVE MODEL`**; both lines = **`FIXED`**.

> **Are we ever showing the actual makeup, or just the limits?** The *lines* are
> the only fixed things. The bar fills, the ratios, the ring density, and the
> printed µg/m³ are all **today's actual (modeled) air**. The lines are just the
> ruler we hold it against.

---

## 4. "By source" view — the 3D luminous field

This is the **most-modeled** view, and the label in the UI always says so. It
answers "the official number is one PM2.5 mass — but what *is* that mass made of?"

**PM2.5 is not a source; it's a bucket** ("everything < 2.5 µm"). This view
decomposes that bucket. That's why PM2.5/PM10 appear in *By pollutant* (as measured
buckets) but not here (here they're the thing being split apart).

### The source split ([composition.js](../src/lib/composition.js) `composition()`) — `MODELED BY US`

We apportion the PM2.5 mass across buckets using **other live pollutants as
proxies**. Each is tied to a measured input, so zero input → zero share (no
artificial floors):

| Source bucket | Proxy formula | Why |
|---|---|---|
| **Combustion soot** | `NO₂/40 + CO/500` | traffic/combustion gases travel with soot |
| **Road & brake dust** | `dust/25` | the model's dust channel |
| **Sulfate & nitrate haze** | `SO₂/20` | SO₂ is the *gas* that becomes that particle |
| **Wildfire char** | PM2.5 above ~35 that traffic gases don't explain (`no2 < 15`) | smoke = lots of PM2.5, few traffic gases |
| **Pollen & biological** | `0` | no measured proxy exists → stays zero |

These are normalized to fractions summing to 1 (the "official" breath). The proxy
inputs are **`LIVE MODEL`** values; the apportionment is **`MODELED BY US`**.

**Ultrafine** (`ultrafineIndex = clamp(combustion, 0, 3)`) is tracked *separately* —
it sits outside the PM2.5 mass number entirely, so it never counts toward the 100%
and the legal/WHO line never "clears" it. Also **`MODELED BY US`**.

### The particle field ([airParticleSketch.js](../src/viz/airParticleSketch.js) `buildSource` / `drawSource3D`)

| Field property | Driven by | Provenance |
|---|---|---|
| **How many specks total** | `ratio = PM2.5 ÷ line` (0–6) → `map(ratio, 0,6, 40,1050)` × screen scale | count itself is **`DECORATIVE`**; the *ratio* is **`LIVE MODEL`** vs a **`FIXED`** line |
| **Proportion of each color** | the modeled source fractions | **`MODELED BY US`** |
| **Number of ultrafine (red) specks** | `ultrafineIndex × 150 × scale`, independent of the line | **`MODELED BY US`** |
| **Speck color** | fixed per-source hue (`SOURCES[].color`) | **`FIXED`** |
| **Drift speed (agitation)** | mapped from AQI (0.5×–2.5×) | **`LIVE MODEL`** (aesthetic) |
| **Speck position, depth, glow, orbit, zoom** | 3D layout & interaction | **`DECORATIVE`** — no value |

So the field encodes exactly two data facts: **the mix** (proportions of color) and
**the intensity** (how far PM2.5 sits over the chosen line). Everything else — where
each orb sits, how it drifts, the luminous glow, the fact that you can orbit and
zoom through it — is presentation.

### The legend (`SourceLegend`)

- **Percentages** = the modeled fractions, rounded (`MODELED BY US`). 0% rows are
  hidden. **We show percentages, not raw counts** — because the counts are density.
- Ultrafine is broken out with a "modeled swarm" tag, never a percentage.
- Toggling a row hides that source in the field (drives the sketch `hidden` set).

---

## 5. Baseline atmosphere (before you search / at `/`)

Component: `BASELINE_LAYERS` in [airParticleSketch.js](../src/viz/airParticleSketch.js).

This is **`FIXED`** textbook chemistry, not data: N₂ 78%, O₂ 21%, Ar 0.93%, CO₂
0.04%, Ne + trace. Particle counts per ring are proportional to those constant
percentages. It exists to set the frame — *a breath is 99.9% N₂/O₂/Ar; everything
the rest of the tool draws is the leftover sliver.* Hover tooltips name each gas.

---

## 6. What carries **no** data (so you don't over-read it)

Honest list of the purely `DECORATIVE` encodings:

- **Ring radius and order** — layout. Density carries the value, radius does not.
- **Every particle's position and motion** — Brownian drift, the 3D orbit/zoom, the
  pulse "breathing." Motion *speed* tracks AQI as a mood cue, but no individual
  particle is a data point.
- **Glow / luminosity** — the "by source" orbs are lit for atmosphere; brightness is
  depth, not concentration.
- **Absolute particle counts** — density, capped for performance and scaled by
  screen size. Read the **%** and the **×** instead.

---

## 7. One-screen reference

| Visualization element | The value behind it | Provenance |
|---|---|---|
| Headline AQI + gauge needle | AirNow reading, else model max-AQI/NowCast | `MEASURED` / `LIVE MODEL` |
| `MEASURED` chips (PM2.5 62, O₃ 50 …) | AirNow per-pollutant AQIs | `MEASURED` |
| "CAMS model reads 59" comparison | Live model AQI | `LIVE MODEL` |
| Six sub-index chips | Live model per-pollutant AQIs | `LIVE MODEL` |
| Per-pollutant µg/m³ (bars & rings) | Live model concentration | `LIVE MODEL` |
| Ring **density** / bar **fill** / **×** | concentration ÷ (WHO or legal) | value `LIVE MODEL` · line `FIXED` |
| WHO & US legal lines | Regulatory constants | `FIXED` |
| Ring/bar/tooltip **colors** | Per-pollutant hue | `FIXED` |
| "By source" color mix + % | PM2.5 apportioned by proxy pollutants | `MODELED BY US` |
| Ultrafine swarm | Combustion-tracked index, outside the mass | `MODELED BY US` |
| Total speck count | PM2.5 ÷ line → density | `DECORATIVE` (ratio is `LIVE MODEL`) |
| Particle positions / drift / glow / orbit | Layout & interaction | `DECORATIVE` |
| Baseline atmosphere rings | Constant composition of clean air | `FIXED` |
| Scenario presets (`/cigarette` …) | Typical published literature figures | `ILLUSTRATIVE` |
| Typical-annual fallback | Nearest monitor's 2024 average | `ILLUSTRATIVE` |
| Nearest-monitor distance | Compiled EPA station list | `FIXED` reference |

---

### The one-line summary

> **Measured** where a monitor is close (the headline). **Live model** for the
> per-pollutant concentrations that drive the rings and bars. **Modeled by us** for
> the source split and the ultrafine swarm — clearly labeled, never presented as a
> reading. The WHO/legal lines are **fixed yardsticks**, and most of the motion and
> glow is **just presentation**.
