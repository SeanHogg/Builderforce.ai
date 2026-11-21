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
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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
  /** The row shown when candidates exist but none matches, so the person sees the trigger was recognised. */
  emptyLabel: string;
  /** Open (on the empty row) even with no candidates at all. Default false: nothing to offer ⇒ stay closed. */
  openWithoutCandidates?: boolean;
  /**
   * Enter on a row `isDisabled` refuses: the text to submit instead of what was typed (e.g. the full `/<id>`, so the
   * host can say why it cannot run). The box's own submit then runs. Omitted ⇒ the typed text is submitted.
   */
  disabledEnterEdit?: (item: T, token: TriggerToken, text: string) => TriggerEdit | null;
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
    listLabel, heading, emptyLabel, openWithoutCandidates = false, disabledEnterEdit,
  } = opts;
  const [token, setToken] = useState<TriggerToken | null>(null);
  const [index, setIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = useCallback((i: number) => `${baseId}-opt-${i}`, [baseId]);
  // The text a pick just wrote (and where it put the caret): re-detecting on it would re-open the popup on the
  // reference the pick inserted (`#9`), so it is skipped until the person changes the text or moves the caret.
  // `settling` covers the frame between the new value and the caret the pick sets.
  const lastPick = useRef<(TriggerEdit & { settling: boolean }) | null>(null);

  const matches = useMemo(
    () => (token && enabled ? filter(candidates, token.query) : []),
    [token, enabled, filter, candidates],
  );
  // No candidates at all ⇒ closed (nothing here to offer), unless the trigger says its empty row is still news.
  const open = enabled && token != null && (candidates.length > 0 || openWithoutCandidates);
  const active = matches.length ? Math.min(index, matches.length - 1) : 0;

  // Re-detect the token from the live caret. Cheap; safe to call often.
  const recompute = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !enabled) { setToken(null); return; }
    const caret = el.selectionStart ?? el.value.length;
    const pick = lastPick.current;
    if (pick && el.value === pick.text && (pick.settling || caret === pick.caret)) { setToken(null); return; }
    lastPick.current = null;
    const next = detect(el.value, caret);
    setToken((prev) => (sameToken(prev, next) ? prev : next));
    setIndex(0);
  }, [textareaRef, enabled, detect]);

  // The value change commits the caret too, so recompute after every edit.
  useEffect(() => { recompute(); }, [value, recompute]);

  /** Write an edit into the box and put the caret where it says, after React commits the value. */
  const apply = useCallback((next: TriggerEdit) => {
    const pick = { ...next, settling: true };
    lastPick.current = pick;
    setValue(next.text);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (node) { node.focus(); try { node.setSelectionRange(next.caret, next.caret); } catch { /* noop */ } }
      pick.settling = false;
    });
  }, [setValue, textareaRef]);

  const tokenNow = useCallback(() => {
    const el = textareaRef.current;
    return token ?? (el ? detect(el.value, el.selectionStart ?? 0) : null);
  }, [token, detect, textareaRef]);

  const choose = useCallback((item: T) => {
    const tk = tokenNow();
    const next = tk ? edit(item, tk, value) : null;
    if (next) apply(next);
    setToken(null);
    onPick(item);
  }, [tokenNow, edit, value, apply, onPick]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    // An IME is composing: every key is the input method's.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (!open) return false;
    if (e.key === 'Escape') { e.preventDefault(); setToken(null); return true; }
    // Nothing to pick: the keys stay the box's (Enter submits, arrows move the caret).
    if (matches.length === 0) return false;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setIndex((active + 1) % matches.length); return true;
      case 'ArrowUp': e.preventDefault(); setIndex((active - 1 + matches.length) % matches.length); return true;
      case 'Enter':
      case 'Tab': {
        // Shift+Enter is a newline, never a pick.
        if (e.key === 'Enter' && e.shiftKey) return false;
        const item = matches[active];
        if (isDisabled?.(item)) {
          // A row that cannot be picked: Enter submits it as typed in full (the host says why), Tab does nothing.
          if (e.key === 'Enter') {
            const tk = tokenNow();
            const next = tk && disabledEnterEdit ? disabledEnterEdit(item, tk, value) : null;
            if (next) { lastPick.current = { ...next, settling: true }; setValue(next.text); setToken(null); }
          }
          return false;
        }
        e.preventDefault();
        choose(item);
        return true;
      }
      default: return false;
    }
  }, [open, matches, active, isDisabled, disabledEnterEdit, tokenNow, value, setValue, choose]);

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
