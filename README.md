# Gourmet Data project template

The starting point for small, self-contained **data tool pages**: fetch data
from a source, let the user look something up by zip / address / county,
visualize the result (brand SVG charts, p5 canvas, or d3 diagram), and embed
the whole thing in any host site via iframe.
   
Each new project is a clone of this repo with the demo gutted and the wiring
kept. It ships one working example — the **air quality demo** (`/air/:zip`) —
that exercises every seam end to end.

```sh
npm install
npm run dev      # → http://localhost:5173, try /air/77002
npm run build
```

## The three priorities (these break ties)

1. **Simplicity.** Idiomatic React/JS. Prefer a few more lines of plain code
   over a clever abstraction. No bespoke object frameworks.
2. **Customizability.** New data sources, new viz styles, and new lookup key
   types each slot in by writing **one new file that follows a convention** —
   not by editing a central engine.
3. **Embeddability.** Every page runs standalone in an iframe with correct
   auto-height, no global-state leakage, and graceful error states.

On dependencies: keep the count low, but generally useful tools are welcome —
including new ones — when they genuinely save complexity. Don't hand-roll what
a good library does well; don't add a library to save ten lines.

## Where things go (the seams)

| You want to… | Do this |
|---|---|
| Change title / tagline / nav / attribution | Edit `src/site.config.js` (the one content file) |
| Add a **data source** | New file in `src/data/` exporting plain async functions — see `src/data/airQuality.js` for the three modes (baked static, direct API, serverless proxy) |
| Add a **visualization** | New component in `src/viz/`; register it in `src/viz/registry.js` only if a config-driven page needs to pick it by string. p5 sketches go through `P5Sketch.jsx`, d3 through `D3Chart.jsx` |
| Add a **tool page** | New file in `src/pages/` wired like `AirPage.jsx` (param route → `useAsync` → viz), plus a `<Route>` in `App.jsx` |
| Add a **lookup key type** | New small form component next to `LookupInput.jsx`; addresses resolve through `src/lib/geocode.js` (US Census geocoder, free, no key) |
| Hide an API key / dodge CORS | New `api/<name>.js` serverless function — see `api/air.js` |
| Bake static per-key data | `scripts/pipeline/bake.py` → `public/data/<tool>/<key>.json`, committed |
| Change the brand look | `src/lib/brandChart.jsx` (charts) + `tailwind.config.js` (page chrome) — keep the hex values in agreement |
| Define a controlled category list | `schema/vocabularies.json` — shared by UI and pipeline, defined once |

Async state is handled by one owned ~30-line hook, `src/lib/useAsync.js`
(loading / error / done + per-key cache). Read it once; that's the whole story.

## Starting a new project from this template

1. Clone, rename in `package.json`, and update `src/site.config.js` +
   `index.html` (title, description).
2. Delete the demo: `src/pages/AirPage.jsx`, `src/data/airQuality.js`,
   `src/viz/airSketch.js`, `public/data/air/`, and the demo routes in
   `App.jsx` / nav in `site.config.js`. (Or keep it around as a crib until
   your first tool works.)
3. Write your data module, your page, your viz — one file each.
4. Flip `dataStatus` in `site.config.js` from `'sample'` to `'live'` only when
   the data is real. Nothing fabricated should ever read as real analysis.

## Deployment

Built for **Vercel** (static build + `api/` serverless functions from one
repo): import the repo in Vercel, done. `vercel.json` already rewrites SPA
routes so `/air/77002` deep-links work. Secrets for proxy functions go in
Vercel env vars, never in the bundle. Cloudflare Pages also works for
static-only projects (add a `_redirects` file; port `api/` to Pages Functions
if needed).

Embedding — auto-height iframe snippet and subpath builds — is documented in
[docs/EMBEDDING.md](docs/EMBEDDING.md).

## Checklist for every tool (bake these in from the start)

- Result state lives in the **URL** (`/air/:zip`), not just component state.
- Every lookup failure renders a styled error (`ErrorState`), never a blank
  screen.
- Viz is responsive: SVG uses `viewBox` + `width="100%"`; p5 handles
  `windowResized`.
- p5 sketches are **instance mode** only (a `(p, data) =>` function passed to
  `P5Sketch`), never global mode.
- Import d3 by module (`d3-chord`, `d3-scale`, …), never the monolithic `d3`.
- Every chart reads colors from `BRAND` so all viz types look like one brand.
- Attribution for the upstream data source appears on every page (footer).

## Not in v1, deliberately

Ads / Stripe. The architecture already leaves room (a `api/stripe.js` function
plus a page), so nothing needs restructuring when it's time.
