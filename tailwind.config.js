/**
 * Tailwind palette = the Gourmet Data brand, mirrored so utility classes
 * (bg-cream, text-ink, bg-data-primary …) stay in sync with the chart engine
 * in src/lib/brandChart.jsx. brandChart.jsx is the source of truth for CHARTS,
 * this file is the source of truth for PAGE CHROME. Both trace back to
 * brand-graph-style.md. Keep the hex values identical in both files.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Canvas — warm cream, never pure white (brand rule)
        cream: '#F7F0EF',
        ink: '#383838',
        'ink-muted': '#5A5A5A',
        rose: '#E08484', // the brand mark
        // "Data" palette (default)
        data: {
          primary: '#3266AD',
          accent: '#BA7517',
        },
        // "Soft" palette (stacked / categorical)
        soft: {
          olive: '#5C764E',
          sage: '#8CAF78',
          'dusty-rose': '#D09594',
          coral: '#E08484',
        },
        grid: {
          strong: '#CDCDCD',
          medium: '#DDDDDD',
          light: '#EEEEEE',
        },
      },
      fontFamily: {
        // Full fallback stacks so it degrades gracefully where Avenir/Averia
        // are not installed (brand-graph-style.md §2).
        title: ['Avenir Black', 'Avenir', 'Nunito Sans', 'sans-serif'],
        subtitle: ['Averia Sans Libre', 'Georgia', 'serif'],
        body: ['Avenir', 'Nunito Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
