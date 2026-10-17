import { memo } from 'react';

/**
 * Fixed next steps as chips above an empty box — "what now?" answered without a model
 * call. A chip seeds the box; the person reads it, edits it and sends it. Extracted from
 * the web's ComposerSuggestions; `BrainComposer` renders it from its `suggestions` prop
 * and decides when (an empty box, no turn running), so no host re-derives that.
 */
export interface ComposerSuggestion {
  id: string;
  label: string;
  onSelect: () => void;
}

export const SuggestionRow = memo(function SuggestionRow({ items, ariaLabel }: { items: readonly ComposerSuggestion[]; ariaLabel: string }) {
  if (items.length === 0) return null;
  return (
    <div className="bf-suggest" role="group" aria-label={ariaLabel} data-testid="composer-suggestions">
      {items.map((item) => (
        <button key={item.id} type="button" className="bf-suggest__chip" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  );
});
