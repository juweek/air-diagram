// Shared loading / error states for lookup pages. A failed lookup must render
// a plain, styled message — never a blank screen (especially when embedded in
// someone else's page).

export function Loading({ label = 'Looking that up…' }) {
  return <p className="animate-pulse py-6 text-ink-muted">{label}</p>;
}

export function ErrorState({ message }) {
  return (
    <div className="my-4 border-l-4 border-rose bg-white/50 px-4 py-3">
      <p className="font-semibold">Couldn’t complete that lookup.</p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
    </div>
  );
}
