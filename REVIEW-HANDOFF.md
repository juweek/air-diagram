# Review & Fix Handoff — "What's in the Air" (July 11, 2026)

This document summarizes a three-role editorial/product/skeptic review of the
air-quality blog draft + this tool, and records **what was already fixed in the
codebase** vs **what still needs doing**. It is written to be self-contained for
a fresh agent. Repo: `air-quality-react` (see `CLAUDE.md` for architecture).

---

## 1. The verdicts (pre-fix)

**Managing Editor — grade B+** (strategy A, execution B). The piece runs the
brand's proven "legal threshold vs health guideline" spine and both signature
interactive devices (legal↔WHO toggle, "what isn't measured" layer). It passed
the byline test on voice/format and the stakes test at Tier 1 ("a reader in an
unmonitored county stops treating a green AQI as a measurement of their block's
air"). What held it back: **no beat #12 (the chart that didn't exist)** — the
tool visualized public data but compiled nothing proprietary; the draft was
written pre-build ("what I want to build next") and its two most shareable
stats were unsourced. *Editor's ruling: compile the monitor-distance dataset
and the grade moves to A.* → **Done, see §2.**

**Product Lead — build-vs-skip gate:** Utility (used twice?) **no as built**;
Data moat **no** (wrapper on one free API + a modeled composition layer);
Compounding **yes, decisively** (franchise template, B2B portfolio, clips,
Missing Datasets index); Sustainability **conditional** (no cached fallback).
Net: "a beautifully honest illustration wearing a tool's clothes." The one
feature that converts it: **"your nearest monitor is N miles away."** → **Done, see §2.**

**Research Skeptic — no data-accuracy KILLs on the core spine.** Verified clean:
WHO 5 µg/m³ (2021) / EPA 9.0 (2024, down from 12), AQI-as-maximum across six
pollutants, ultrafine exclusion from the PM2.5 mass number, and the tone of the
"honest other side" section. Sustained objections are in §3 (blog) and were
code-level in four places (all fixed, §2).

---

## 2. Fixed in this session (code — all verified in the browser)

1. **Compiled counter-dataset: nearest regulatory PM2.5 monitor (beat #12).**
   - `src/data/pm25Monitors.json` — 1,053 active EPA AQS sites (parameter 88101,
     PM2.5 FRM/FEM, sampled since 2024-06), compiled from
     https://aqs.epa.gov/aqsweb/airdata/aqs_monitors.zip (EPA extraction date
     2025-11-25). Lazy-loaded (own 24KB-gzip chunk; initial bundle untouched).
   - `src/lib/monitors.js` — haversine + `nearestMonitor(lat, lon)`.
   - Wired in `src/data/airQuality.js` (`getByQuery`, parallel with the air
     fetch; failure returns null and never blocks a result).
   - Readout line in `src/pages/AirPage.jsx`: *"Nearest regulatory PM2.5
     monitor: 47 mi away — Sidney 201 (Richland County, MT). Your number is a
     model stretched over that gap. Only ~1 in 5 US counties has one at all."*
   - **Bonus fact for the blog:** the compile independently confirms the post's
     "1 in 5 counties" claim — **648 of ~3,144 US counties (≈21%)** have an
     active regulatory PM2.5 monitor. Cite our own dataset.
   - Refresh cadence: ~yearly; re-run the compile script against a fresh
     `aqs_monitors.zip` (script logic documented in `src/lib/monitors.js` header).

2. **"This reading is a model" labeling (was KILL-level).** Open-Meteo serves
   CAMS model output (~11 km grid), not monitor readings; the UI now says so in
   the readout ("modeled estimate… not a monitor reading"), the source line
   ("Open-Meteo Air Quality API (CAMS model, ~11 km grid)"), and
   `src/site.config.js` attribution. The tool no longer commits the sin the
   post critiques — it now *demonstrates* it.

3. **AQI headline bug (could misread ozone days).** The readout used the PM2.5
   NowCast alone. Now `fetchAirQuality` requests per-pollutant AQIs
   (`us_aqi_*`) and `headlineAqi()` in `AirPage.jsx` takes the maximum and
   names the driver ("Today's driver: ozone"). Verified live: Wolf Point MT
   read 34/ozone where the old code would have shown ~6.

4. **`bio = 0.1` additive floor removed** (`src/lib/composition.js`). It
   violated the project's own zero-means-zero rule — in clean air it conjured
   ~19% "Pollen & biological" with no measured basis. Now 0 (no proxy exists in
   the API fields); the bucket remains for a future pollen feed. The green
   specks and legend row disappear, honestly.

5. **Scenario AQIs now derived, not hand-set** (`src/data/scenarios.js` +
   `pm10Aqi`/clamp-at-500 in `src/lib/nowcast.js`). The cigarette preset
   claimed AQI 425 while its own 350 µg/m³ computes to 500. Now: cigarette 500,
   joint 500, wildfire 350, traffic 124, dust storm 496 (PM10-driven). The
   meter can never disagree with the concentrations beside it.

6. **Speck counts de-quantified.** Raw counts were rendering density (they
   changed with screen width). Legend now shows percentages only; ultrafine
   reads "modeled swarm," footnote says "a modeled intensity, not a count."

7. **Averaging-period caveat** added to the by-pollutant view copy ("lines use
   different averaging periods — read the bars as scale, not a compliance
   ruling").

`npm run build` passes; `/Detroit`, `/59201`, `/cigarette`, `/dust-storm` all
verified rendering in the browser.

---

## 3. Still to do — blog draft (Skeptic-sustained, must fix before publish)

1. **Replace ">90% of the world" with ~99%.** The 90% figure belongs to the old
   2005 WHO guideline (10 µg/m³); against the 2021 guideline of 5 the number is
   ~99% (ES&T Letters 2022, doi 10.1021/acs.estlett.2c00203 — in the source
   rolodex). Stronger for the thesis. Fix the "sparsely populated corners"
   sentence, which only makes sense at the old line.
2. **Pin the 2.8M / 44%-of-metros stat** to ES&T Letters 2024
   (doi 10.1021/acs.estlett.4c00605) — currently unlinked and unverified. If
   the exact figures can't be confirmed in the paper, soften to directional.
   The "1 in 5 counties" claim can now cite **our own compiled dataset** (§2.1).
3. **Annual-vs-daily clause.** The daily green icon is a 24-hr construct; the
   9-vs-5 comparison is annual. One clause distinguishing them blocks the
   obvious EPA rebuttal.
4. **"~40% since 2000" needs its endpoint year** + the epa.gov/air-trends link.
5. **Rewrite around the built tool** — present tense, delete the "Airnow is a
   good site" stub and the "what I want to build next" framing; render a real
   canonical chart for beat #1; add one sentence conceding max-not-average is a
   deliberate safety design (the steelman's strongest point); carry the
   modeled-source-split disclaimer at the same prominence as the tool does.

## 4. Still to do — tool (longevity & v2)

- **Static fallback** (~100 metros' typical annual levels compiled from EPA
  annual summaries) shown as "typical air near X" when the live API fails.
  Currently a fetch failure kills every live lookup.
- **Zippopotam backup** — flakiest dependency; fall back to the Open-Meteo
  geocoder or ship the Census ZIP-centroid gazetteer statically.
- **Open-Meteo licensing** — free tier is non-commercial; confirm terms or
  budget the paid plan before the post drives traffic. **(Human decision.)**
- "Standards as of 2024" note in UI copy so hardcoded breakpoints age honestly.
- v2 features (hold for follow-up posts): compare-two-places URLs
  (`/Detroit/vs/Phoenix`); "days over the WHO line last year" via Open-Meteo's
  historical endpoint; share button + per-state OG meta; embed snippet
  generator (B2B artifact). **Skip:** accounts, alerts, backends, more canvas polish.

## 5. Distribution (from the Managing Editor)

- #1 Short: the legal↔WHO toggle flip on one ZIP (cold open). #2: `/` baseline →
  `/cigarette` jump. End every clip with "type your ZIP."
- Reddit lead (r/dataisbeautiful, r/environment): the monitor-gap finding +
  a direct `/theirZIP` link — now backed by our own dataset.
- LinkedIn pull: the reframe + the 9-vs-5 gap. Substack Note alongside.
- Record the long-form walkthrough and the clips in one session, face on
  camera (the speaker reel is the speaking-goal engine).
- Package the embeddable tool as a one-page B2B case study ("we make
  regulatory data legible") for sustainability teams / environmental orgs.
- Missing Datasets index entries seeded: ultrafine particles (existing);
  **new:** "the unmonitored counties — nobody publishes how far each American
  lives from the monitor their AQI is interpolated from" (we now do).

## 6. Open decisions for the human

1. Wording/tone of the modeled-estimate and monitor-gap lines (drafted; taste
   pass welcome).
2. Open-Meteo license: stay free tier (add fallback) or pay.
3. Bio bucket: currently honest-zero; restore only if a real pollen data feed
   is wired in.
4. Build the static fallback before or after the post ships.
5. Pull compare-two-places into v1, or hold as its own follow-up hook.
