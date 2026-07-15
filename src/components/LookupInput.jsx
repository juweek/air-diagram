import { useState } from 'react';

/**
 * The lookup form. Style-2 editorial treatment: an underlined text field with a
 * trailing filled pill button. What you TYPE is display-serif italic; the
 * placeholder is deliberately the opposite — the same tracked-uppercase sans as
 * the "Search" label — so the empty state reads as UI, not as content.
 * Behaviourally it's still a plain pass-through: the user types a key (ZIP or
 * city) and we call onSubmit(query) with the trimmed text; resolution happens
 * in the data layer.
 */
export default function LookupInput({
  onSubmit,
  defaultValue = '',
  placeholder = 'a ZIP code or city (48226 or Detroit)',
  buttonLabel = 'Search',
  large = false, // landing-hero treatment: bigger type, labelled submit
}) {
  const [value, setValue] = useState(defaultValue);

  function handleSubmit(e) {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;
    onSubmit(query);
  }

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className={large ? 'w-full' : 'max-w-md'}>
      <div
        className={`flex items-center gap-3 border-b border-grid-strong transition-colors focus-within:border-ink ${
          large ? 'pb-2' : 'pb-1'
        }`}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label="ZIP code or city"
          className={`w-full bg-transparent font-display italic text-ink-bright placeholder:font-body placeholder:font-semibold placeholder:uppercase placeholder:not-italic placeholder:tracking-[0.12em] placeholder:text-ink-muted/70 focus:outline-none ${
            large
              ? 'text-xl placeholder:text-xs sm:text-2xl sm:placeholder:text-sm'
              : 'text-lg placeholder:text-xs'
          }`}
        />
        <button
          type="submit"
          aria-label={buttonLabel}
          className={`flex shrink-0 items-baseline gap-2 rounded-lg bg-data-primary leading-none !text-cream transition-colors hover:bg-ink-bright ${
            large ? 'px-4 py-2' : 'px-3 py-1.5'
          }`}
        >
          {large && <span className="label-caps !text-inherit">Search</span>}
          <span className={large ? 'text-xl' : 'text-lg'}>→</span>
        </button>
      </div>
    </form>
  );
}
