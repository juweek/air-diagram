// One entry per pollutant returned by the Open-Meteo air quality API.
//
// `range` is the typical urban span in µg/m³: `range[0]` maps to 0 (barely
// there) and `range[1]` maps to 1 (a high day for a US city). It drives the
// readout level bars.
//
// `who` and `legal` are two reference lines in µg/m³ — the WHO 2021 health
// guideline and the US EPA legal standard (NAAQS). The legal line is always
// looser (higher) than the health line; that gap is the whole point of the
// piece. Averaging periods are mixed (PM2.5 is annual, most others 24-hour or
// 1-hour) so these are illustrative reference lines, not a compliance
// calculation — see the notes below.
//
// Colors reuse the palette from the original atmosphere diagram.
export const POLLUTANTS = [
  {
    key: 'pm2_5',
    label: 'PM2.5',
    name: 'Fine particles',
    unit: 'µg/m³',
    range: [0, 40],
    who: 5, // WHO annual guideline
    legal: 9, // EPA annual NAAQS (2024; was 12)
    color: '#2A2A28F2',
    centered: true,
  },
  {
    key: 'pm10',
    label: 'PM10',
    name: 'Coarse particles',
    unit: 'µg/m³',
    range: [0, 60],
    who: 45, // WHO 24-hour
    legal: 150, // EPA 24-hour NAAQS
    color: '#BD9B18AA',
    semiCentered: true,
  },
  {
    key: 'ozone',
    label: 'O₃',
    name: 'Ozone',
    unit: 'µg/m³',
    range: [20, 180],
    who: 100, // WHO 8-hour
    legal: 137, // EPA 8-hour NAAQS (0.070 ppm ≈ 137 µg/m³)
    color: '#221DD76D',
  },
  {
    key: 'nitrogen_dioxide',
    label: 'NO₂',
    name: 'Nitrogen dioxide',
    unit: 'µg/m³',
    range: [0, 60],
    who: 25, // WHO 24-hour
    legal: 188, // EPA 1-hour NAAQS (100 ppb ≈ 188 µg/m³)
    color: '#E41919B0',
  },
  {
    key: 'sulphur_dioxide',
    label: 'SO₂',
    name: 'Sulfur dioxide',
    unit: 'µg/m³',
    range: [0, 20],
    who: 40, // WHO 24-hour
    legal: 196, // EPA 1-hour NAAQS (75 ppb ≈ 196 µg/m³)
    color: '#08A0108E',
  },
  {
    key: 'carbon_monoxide',
    label: 'CO',
    name: 'Carbon monoxide',
    unit: 'µg/m³',
    range: [50, 600],
    who: 4000, // WHO 24-hour (4 mg/m³)
    legal: 40000, // EPA 1-hour NAAQS (35 ppm ≈ 40 mg/m³)
    color: '#D45D9E6D',
  },
  {
    key: 'dust',
    label: 'Dust',
    name: 'Airborne dust',
    unit: 'µg/m³',
    range: [0, 25],
    who: 45, // no dust-specific guideline; borrow PM10 24-hour
    legal: 150,
    color: '#B56515AA',
  },
];

// The headline pollutant's two lines, pulled out so the source view and the
// legend don't have to dig through POLLUTANTS.
export const PM25_LINES = { who: 5, legal: 9 };

// 0 = bottom of the typical urban range, 1 = a high day. Allowed to run a
// little past 1 so genuinely bad days keep growing.
export function pollutantNorm(def, value) {
  const [min, max] = def.range;
  const norm = (value - min) / (max - min);
  return Math.max(0, Math.min(norm, 1.25));
}

// How many times over the active reference line a reading sits. `mode` is
// 'legal' or 'who'. 1.0 means "exactly at the line"; 2.0 means "twice the
// line". Because the WHO line is lower, flipping to it raises every reading's
// exceedance — which is what makes the same air fill with specks.
export function exceedance(def, value, mode = 'legal') {
  const line = mode === 'who' ? def.who : def.legal;
  if (!line || value == null) return 0;
  return Math.max(0, value / line);
}

// US EPA AQI categories with their standard colors.
export function aqiCategory(aqi) {
  if (aqi == null) return { name: 'Unknown', color: '#999999' };
  if (aqi <= 50) return { name: 'Good', color: '#3B9C46' };
  if (aqi <= 100) return { name: 'Moderate', color: '#C7A70A' };
  if (aqi <= 150) return { name: 'Unhealthy for sensitive groups', color: '#E07C00' };
  if (aqi <= 200) return { name: 'Unhealthy', color: '#D6392F' };
  if (aqi <= 300) return { name: 'Very unhealthy', color: '#8F3F97' };
  return { name: 'Hazardous', color: '#7E0023' };
}
