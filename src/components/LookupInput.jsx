import { useState } from 'react';

/**
 * The lookup form: the user types a key (a ZIP code OR a city name) and we call
 * onSubmit(query) with the trimmed text. Resolution (zip → Zippopotam,
 * city → Open-Meteo geocoder) happens in the data function, so this component
 * stays a plain pass-through — it only guards against an empty submit.
 */
export default function LookupInput({
  onSubmit,
  defaultValue = '',
  placeholder = 'ZIP code or city — e.g. 48226 or Detroit',
  buttonLabel = 'Look up',
}) {
  const [value, setValue] = useState(defaultValue);

  function handleSubmit(e) {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;
    onSubmit(query);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3" autoComplete="off">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="ZIP code or city"
        className="w-72 max-w-full rounded border border-grid-strong bg-white/60 px-3 py-2 text-ink placeholder:text-ink-muted/60 focus:border-data-primary focus:outline-none"
      />
      <button
        type="submit"
        className="rounded bg-data-primary px-4 py-2 font-body font-semibold text-cream transition-colors hover:bg-data-accent"
      >
        {buttonLabel}
      </button>
    </form>
  );
}
