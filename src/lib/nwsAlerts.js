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
    // Return EVERY active air alert for this point, worst-first (NWS already
    // orders by severity/onset). The alert carries its OWN text — `description`
    // is the full message and `areaDesc` the specific counties/zones — so that
    // is the immediate, area-specific answer and we surface it inline instead of
    // sending people to a generic list page (the old per-alert human pages on
    // alerts.weather.gov were retired; the API's `web` field is just weather.gov).
    const mapped = air.map((a) => ({
      id: a.id ?? a['@id'] ?? `${a.event}-${a.sent}`,
      event: a.event,
      headline: a.headline ?? null,
      areaDesc: a.areaDesc ?? null,
      description: a.description ?? null,
      instruction: a.instruction ?? null,
      until: a.ends ?? a.expires ?? null,
      sender: a.senderName ?? null,
    }));
    const seen = new Set();
    const deduped = [];
    for (const alert of mapped) {
      const key = [
        alert.id,
        alert.event,
        alert.areaDesc,
        alert.description,
        alert.until,
        alert.sender,
      ]
        .filter(Boolean)
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(alert);
    }
    return deduped.length ? deduped : null;
  } catch {
    return null;
  }
}
