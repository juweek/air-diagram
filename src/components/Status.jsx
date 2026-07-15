// Shared loading / error states for lookup pages. A failed lookup must render
// a plain, styled message — never a blank screen (especially when embedded in
// someone else's page). The canvas keeps showing Earth's clean breath rings
// while this label sits above — so loading doesn't swap to a different visual.
export function Loading({ label = 'Looking that up…' }) {
  return (
    <p className="py-3 text-center text-sm text-ink-muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorState({ message }) {
  return (
    <div className="my-4 border-l-4 border-rose bg-cream/50 px-4 py-3">
      <p className="font-semibold">Couldn’t complete that lookup.</p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
    </div>
  );
}
