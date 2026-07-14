/**
 * Tailwind palette. The semantic tokens (cream/ink/grid…) intentionally keep
 * their original NAMES but now resolve to CSS custom properties defined in
 * src/index.css (see the ":root — design tokens" block there). That indirection
 * is the whole point: the entire page reskins by editing that one token block,
 * so a new design in this family is a theme swap, not a component rewrite.
 *
 * Each colour is written in the `rgb(var(--x) / <alpha-value>)` form so opacity
 * utilities (bg-cream/40, text-ink-muted/70 …) keep working through the variable.
 */
/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ground / surfaces (was the light "cream" canvas).
        cream: token('--ground'),
        'ground-lift': token('--ground-lift'),
        // Text tiers (was near-black "ink").
        ink: token('--sand'),
        'ink-muted': token('--sand-muted'),
        'ink-bright': token('--sand-bright'),
        rose: '#E0A46A', // warm brand mark, tuned into the dusk palette
        // Accents — links / active states.
        data: {
          primary: token('--accent'),
          accent: token('--sand-bright'),
        },
        // Hairlines / tracks (was light greys).
        grid: {
          strong: token('--hairline-strong'),
          medium: token('--hairline'),
          light: token('--hairline'),
        },
      },
      fontFamily: {
        // Editorial serif for display + poetic lines; neutral system sans for
        // tracked-uppercase labels and running body copy.
        title: ['Fraunces', 'Georgia', 'serif'],
        subtitle: ['Fraunces', 'Georgia', 'serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        body: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
