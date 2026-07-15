import { useState } from 'react';

/**
 * The lookup form. Style-2 editorial treatment: an underlined text field with an
 * italic placeholder and a trailing arrow — no boxed input. Behaviourally it's
 * still a plain pass-through: the user types a key (ZIP or city) and we call
 * onSubmit(query) with the trimmed text; resolution happens in the data layer.
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
          className={`w-full bg-transparent font-display italic text-ink-bright placeholder:text-ink-muted/70 focus:outline-none ${
            large ? 'text-xl sm:text-2xl' : 'text-lg'
          }`}
        />
        <button
          type="submit"
          aria-label={buttonLabel}
          className="flex shrink-0 items-baseline gap-2 leading-none text-ink-muted transition-colors hover:text-ink-bright"
        >
          {large && <span className="label-caps !text-inherit">Search</span>}
          <span className={large ? 'text-2xl' : 'text-xl'}>→</span>
        </button>
      </div>
    </form>
  );
}
