// One-off compile: EPA annual_conc_by_monitor_2024.csv → src/data/pm25Typical.json
// Rows are [lat, lon, annualMeanPM25] for each PM2.5 (88101) FRM/FEM site — the
// static fallback shown as "typical air near X" when the live API is down.
// Refresh ~yearly against a fresh annual_conc_by_monitor_YYYY.zip.
//   node scripts/buildTypical.mjs /tmp/annual_conc_by_monitor_2024.csv
import fs from 'fs';

const csvPath = process.argv[2] || '/tmp/annual_conc_by_monitor_2024.csv';
const text = fs.readFileSync(csvPath, 'utf8');

// Minimal RFC4180 parser (quoted fields may contain commas).
function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = text.split(/\r?\n/);
const H = parseLine(lines[0]);
const col = (name) => H.indexOf(name);
const iParam = col('Parameter Code');
const iLat = col('Latitude');
const iLon = col('Longitude');
const iDur = col('Sample Duration');
const iEvent = col('Event Type');
const iMean = col('Arithmetic Mean');

const bySite = new Map();
let considered = 0;
for (let li = 1; li < lines.length; li++) {
  if (!lines[li]) continue;
  const r = parseLine(lines[li]);
  if (r[iParam] !== '88101') continue; // PM2.5 FRM/FEM mass
  if (!/24/.test(r[iDur] || '')) continue; // 24-hour daily-mean rows
  if (r[iEvent] && r[iEvent] !== 'No Events') continue; // drop wildfire-event dupes
  const mean = parseFloat(r[iMean]);
  const lat = parseFloat(r[iLat]);
  const lon = parseFloat(r[iLon]);
  if (![mean, lat, lon].every(Number.isFinite)) continue;
  if (mean < 0 || mean > 100) continue;
  considered++;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const s = bySite.get(key) || { lat, lon, sum: 0, n: 0 };
  s.sum += mean;
  s.n++;
  bySite.set(key, s);
}

const out = [...bySite.values()].map((s) => [
  +s.lat.toFixed(3),
  +s.lon.toFixed(3),
  +(s.sum / s.n).toFixed(1),
]);
fs.writeFileSync('src/data/pm25Typical.json', JSON.stringify(out));

const vals = out.map((o) => o[2]).sort((a, b) => a - b);
console.log('rows considered:', considered, '| sites:', out.length);
console.log(
  'median annual PM2.5:',
  vals[Math.floor(vals.length / 2)],
  '| min',
  vals[0],
  '| max',
  vals[vals.length - 1]
);
console.log('file KB:', (fs.statSync('src/data/pm25Typical.json').size / 1024).toFixed(1));
console.log('sample:', JSON.stringify(out.slice(0, 3)));
