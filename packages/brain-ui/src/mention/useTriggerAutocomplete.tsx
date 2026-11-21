/**
 * THE composer trigger typeahead — the one machinery behind `@` (direct a message), `#`
 * (tag a ticket) and `/` (run a composer command). Each trigger is a thin adapter over
 * this hook: how its token is detected at the caret, its candidates and their filter,
 * how a row reads, and how a pick edits the text. Everything else lives here once —
 * re-detecting the token from the live caret, the highlighted row, Up/Down/Enter/Tab/
 * Escape, the mouse pick that keeps the caret, the empty-state row and the listbox ARIA.
 *
 * Headless-ish: spread `onKeyDown` / `onSelect` onto YOUR <textarea> (`onKeyDown` FIRST —
 * when it returns true the key was the picker's, so do not submit or insert a newline),
 * put `inputAria` on it, and render `popup` inside a `position: relative` container.
 *
 * While the popup is open with rows, Enter picks the highlighted row instead of
 * submitting. With no rows (nothing matches) only Escape is the picker's: Enter still
 * submits, so a line that merely starts with a trigger character is never trapped.
 */
import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { TriggerPopup } from './TriggerPopup';

/** The trigger fragment being typed at the caret: `[start, end)` is what a pick replaces. */
export interface TriggerToken {
  /** What is typed after the trigger character, up to the caret ('' right after it). */
  query: string;
  /** Index of the trigger character. */
  start: number;
  /** Index just past the fragment a pick replaces (the caret, or the end of the word). */
  end: number;
}

/** How a pick edits the composer text: the whole new text and where the caret lands. */
export interface TriggerEdit {
  text: string;
  caret: number;
}

export interface UseTriggerAutocompleteOptions<T> {
  /** The composer's <textarea> — read for the live caret. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Current composer text (controlled). */
  value: string;
  /** Setter for the composer text (the one the textarea's onChange calls). */
  setValue: (v: string) => void;
  /** False ⇒ never opens: no source on this surface, a run streaming, the box closed. */
  enabled: boolean;
  /** The token at the caret, or null. A stable (module-level) function. */
  detect: (text: string, caret: number) => TriggerToken | null;
  candidates: readonly T[];
  /** Filter + rank `candidates` for a query; '' ⇒ all of them. A stable (module-level) function. */
  filter: (candidates: readonly T[], query: string) => readonly T[];
  itemKey: (item: T) => string;
  /** One row's content (the row itself, its selection and its events are the primitive's). */
  renderItem: (item: T) => ReactNode;
  /** A row shown (with its reason) but never picked — Enter on it falls through to submit. */
  isDisabled?: (item: T) => boolean;
  /** How picking `item` edits the text; null leaves the text alone. */
  edit: (item: T, token: TriggerToken, text: string) => TriggerEdit | null;
  /** Told after the text was edited. */
  onPick: (item: T) => void;
  /** The listbox's accessible name. */
  listLabel: string;
  /** A visible heading above the rows; omitted ⇒ none. */
  heading?: string;
  /** The row shown when nothing matches, so the person sees the trigger was recognised. */
  emptyLabel: string;
}

/** ARIA for the textarea while a trigger owns it (textbox + listbox popup). */
export interface TriggerInputAria {
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
}

export interface TriggerAutocomplete {
  /** Attach to the textarea's onKeyDown BEFORE your own logic; true ⇒ the key was consumed. */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Attach to the textarea's onSelect so a caret move re-detects the token. */
  onSelect: () => void;
  /** The popup element; render it inside a `position: relative` container. */
  popup: ReactNode;
  /** True while the popup shows (rows or the empty-state row). */
  open: boolean;
  /** Spread onto the textarea while this trigger is the open one. */
  inputAria: TriggerInputAria;
}

const sameToken = (a: TriggerToken | null, b: TriggerToken | null) =>
  a === b || (!!a && !!b && a.query === b.query && a.start === b.start && a.end === b.end);

export function useTriggerAutocomplete<T>(opts: UseTriggerAutocompleteOptions<T>): TriggerAutocomplete {
  const {
    textareaRef, value, setValue, enabled, detect, candidates, filter, itemKey, renderItem, isDisabled, edit, onPick,
    listLabel, heading, emptyLabel,
  } = opts;
  const [token, setToken] = useState<TriggerToken | null>(null);
  const [index, setIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = useCallback((i: number) => `${baseId}-opt-${i}`, [baseId]);

  const matches = useMemo(
    () => (token && enabled ? filter(candidates, token.query) : []),
    [token, enabled, filter, candidates],
  );
  const open = enabled && token != null;
  const active = matches.length ? Math.min(index, matches.length - 1) : 0;

  // Re-detect the token from the live caret. Cheap; safe to call often.
  const recompute = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !enabled) { setToken(null); return; }
    const next = detect(el.value, el.selectionStart ?? el.value.length);
    setToken((prev) => (sameToken(prev, next) ? prev : next));
    setIndex(0);
  }, [textareaRef, enabled, detect]);

  // The value change commits the caret too, so recompute after every edit.
  useEffect(() => { recompute(); }, [value, recompute]);

  const choose = useCallback((item: T) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? detect(el.value, el.selectionStart ?? 0) : null);
    const next = tk ? edit(item, tk, value) : null;
    if (next) {
      setValue(next.text);
      // Put the caret where the pick says, after React commits the new value.
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) { node.focus(); try { node.setSelectionRange(next.caret, next.caret); } catch { /* noop */ } }
      });
    }
    setToken(null);
    onPick(item);
  }, [token, detect, edit, value, setValue, onPick, textareaRef]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'Escape') { e.preventDefault(); setToken(null); return true; }
    // Nothing to pick: the keys stay the box's (Enter submits, arrows move the caret).
    if (matches.length === 0) return false;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setIndex((active + 1) % matches.length); return true;
      case 'ArrowUp': e.preventDefault(); setIndex((active - 1 + matches.length) % matches.length); return true;
      case 'Enter':
      case 'Tab': {
        if (e.nativeEvent.isComposing) return false;
        const item = matches[active];
        // A row that cannot be picked: Enter submits the line, and the host says why.
        if (isDisabled?.(item)) return false;
        e.preventDefault();
        choose(item);
        return true;
      }
      default: return false;
    }
  }, [open, matches, active, isDisabled, choose]);

  const popup = open
    ? (
      <TriggerPopup
        listId={listId}
        optionId={optionId}
        items={matches}
        active={active}
        itemKey={itemKey}
        renderItem={renderItem}
        isDisabled={isDisabled}
        onHover={setIndex}
        onPick={choose}
        listLabel={listLabel}
        heading={heading}
        emptyLabel={emptyLabel}
      />
    )
    : null;

  const inputAria: TriggerInputAria = open && matches.length
    ? { 'aria-controls': listId, 'aria-activedescendant': optionId(active) }
    : {};

  return { onKeyDown, onSelect: recompute, popup, open, inputAria };
}
