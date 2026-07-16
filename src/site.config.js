/**
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE FILE TO EDIT for a new project's CONTENT.
 * Title, tagline, nav, attribution. Nothing structural lives here.
 * ──────────────────────────────────────────────────────────────────────────
 */
const site = {
  title: "What's in the Air",
  tagline:
    'Search a ZIP code or city to see its air, drawn particle by particle — then flip between the legal line and the health line.',

  // Live data — but live MODEL data: Open-Meteo serves CAMS model output on an
  // ~11 km grid, not monitor readings. The UI says so wherever a number appears.
  dataStatus: 'live',

  // The lookup lives at '/'; '/map' is the compiled counter-dataset — a US map
  // of every regulatory PM2.5 monitor, showing how sparse the network is.
  nav: [
    { path: '/', label: "What's in the Air" },
    { path: '/map', label: 'A glance at the US' },
  ],

  // Header CTA — the tool stays free and ad-free; the "ad" it runs is our own.
  // ⚠ OWNER: confirm/replace this URL (Substack subscribe page or donation link).
  support: {
    label: 'Support the author',
    url: 'https://gourmetdata.substack.com/subscribe',
  },

  // Attribution is required on every page.
  attribution: {
    sourceName: 'Open-Meteo Air Quality API (CAMS model)',
    sourceOrg:
      'measured AQI via AirNow (EPA) where a monitor is near; ZIP lookup via Zippopotam.us; nearest-monitor distances + typical annual levels compiled from EPA AQS (2024–25)',
    sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    note: 'Where a monitor is nearby the headline is a real AirNow reading; otherwise it’s a CAMS model estimate.',
  },
};

export default site;
