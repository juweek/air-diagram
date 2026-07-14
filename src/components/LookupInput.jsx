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
  placeholder = 'a ZIP code or city — e.g. 48226 or Detroit',
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
    <form onSubmit={handleSubmit} autoComplete="off" className="max-w-md">
      <div className="flex items-center gap-3 border-b border-grid-strong pb-1 transition-colors focus-within:border-ink">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label="ZIP code or city"
          className="w-full bg-transparent font-display text-lg italic text-ink-bright placeholder:text-ink-muted/70 focus:outline-none"
        />
        <button
          type="submit"
          aria-label={buttonLabel}
          className="shrink-0 text-xl leading-none text-ink-muted transition-colors hover:text-ink-bright"
        >
          →
        </button>
      </div>
    </form>
  );
}
