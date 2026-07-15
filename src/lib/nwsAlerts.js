// Active NWS alerts for a point, filtered to air-related events.
//
// api.weather.gov is free, keyless and CORS-open — the same class of dependency
// as the rest of the stack (no proxy, no account). Air Quality Alerts are
// authored by state/local air agencies and *distributed* through the NWS feed,
// so coverage varies by state; absence of an alert is not a clean bill of air.
//
// Like nearestMonitor()/fetchMeasured(), this is a garnish: it resolves to null
// on any failure and must never block or fail a lookup.

const ALERTS_URL = 'https://api.weather.gov/alerts/active';

// Event names that are about the air itself (not weather generally). The NWS
// event vocabulary is a fixed list; these are the air-quality members of it.
const AIR_EVENT_RE = /air quality|air stagnation|smoke|blowing dust|dust storm|dust advisory|ozone|ashfall/i;

export async function fetchAirAlerts(latitude, longitude) {
  try {
    const url = new URL(ALERTS_URL);
    // NWS rejects more than 4 decimal places on a point.
    url.searchParams.set('point', `${latitude.toFixed(4)},${longitude.toFixed(4)}`);
    url.searchParams.set('status', 'actual');
    const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const air = (data.features ?? [])
      .map((f) => f.properties)
      .filter((p) => p && AIR_EVENT_RE.test(p.event ?? ''));
    if (air.length === 0) return null;
    // One banner, worst-first: NWS orders by severity/onset already; just take
    // the first and note how many more there are.
    const a = air[0];
    return {
      event: a.event,
      headline: a.headline ?? null,
      until: a.ends ?? a.expires ?? null,
      sender: a.senderName ?? null,
      more: air.length - 1,
      // The public alerts page. (The old alerts.weather.gov host was retired by
      // NWS and no longer resolves; this is its replacement. There's no stable
      // human-facing page per individual alert, so this lists active ones.)
      url: 'https://www.weather.gov/alerts',
    };
  } catch {
    return null;
  }
}
