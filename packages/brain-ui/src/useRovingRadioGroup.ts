/**
 * THE keyboard model for a `role="radiogroup"` of buttons — ONE tab stop (the checked
 * radio, or the first when none is checked: roving `tabIndex`), Arrow keys move focus
 * between the radios (and wrap), Home / End jump to the first / last. Moving focus does
 * not choose — Space / Enter (the button's own click) does, because on these groups a
 * choice changes something real (where the next turn runs, how the cloud is funded).
 *
 * Shared by the inference-mode control and the web's cloud-funding card, so the two
 * radio groups a person meets on the same settings journey behave identically.
 */
import { useCallback, useRef, type KeyboardEvent } from 'react';

/** Where a key moves focus from `index`, or null for a key the group does not handle. */
export function rovingRadioNextIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export interface RovingRadioItemProps<T extends HTMLElement> {
  ref: (el: T | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: (event: KeyboardEvent<T>) => void;
}

/**
 * `count` radios, `checkedIndex` the checked one (-1 / out of range = none). Spread
 * `itemProps(index)` on each radio button.
 */
export function useRovingRadioGroup<T extends HTMLElement = HTMLButtonElement>(
  count: number,
  checkedIndex: number,
): { itemProps: (index: number) => RovingRadioItemProps<T> } {
  const items = useRef<Array<T | null>>([]);
  const stop = checkedIndex >= 0 && checkedIndex < count ? checkedIndex : 0;
  const itemProps = useCallback((index: number): RovingRadioItemProps<T> => ({
    ref: (el) => { items.current[index] = el; },
    tabIndex: index === stop ? 0 : -1,
    onKeyDown: (event) => {
      const to = rovingRadioNextIndex(event.key, index, count);
      if (to === null) return;
      event.preventDefault();
      items.current[to]?.focus();
    },
  }), [count, stop]);
  return { itemProps };
}
