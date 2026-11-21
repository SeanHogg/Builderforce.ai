/**
 * `/` command autocomplete — the composer trigger that lists the host's composer
 * commands (`/help`, `/starter-kit`, `/manifest init` …) the moment `/` is typed in the
 * command position, and narrows them as the name is typed. A thin adapter over
 * {@link useTriggerAutocomplete}, fed by the SAME `PromptOptionsCommands` the `/` menu's
 * Actions tab renders (brain-embedded's `/help` model), so the two never disagree.
 *
 * The command position mirrors the host's rule (`^\s*\/`): a `/` that starts the text.
 * A `//` escape, a path (`/api/users`) and a `/` mid-sentence never open it, and typing
 * the space after the name closes it (the arguments are the person's to type).
 *
 * A pick of a runnable entry (no required argument) clears the typed name and hands the
 * entry to the host's `onChoose`, which runs `/<id>`. Any other entry puts its
 * `insertText` (`/starter-kit `) in the box with the caret after it, for the arguments.
 */
import { useCallback, type ReactNode, type RefObject } from 'react';
import type { ComposerHelpEntry } from '@seanhogg/builderforce-brain-embedded';
import type { PromptOptionsCommands } from '../promptOptions/ActionsPane';
import { useTriggerAutocomplete, type TriggerAutocomplete, type TriggerEdit, type TriggerToken } from './useTriggerAutocomplete';

export interface CommandAutocompleteLabels {
  /** Heading above the list, e.g. "Commands". */
  title?: string;
  /** The row shown when no command matches what was typed. */
  noMatches?: string;
  /** The tag on a command this surface or plan cannot run (its reason shows beside it). */
  unavailable?: string;
}

/** English defaults for a host catalog's missing fields. */
export const DEFAULT_COMMAND_LABELS: Required<CommandAutocompleteLabels> = {
  title: 'Commands',
  noMatches: 'No matching commands',
  unavailable: 'Unavailable',
};

/**
 * The `/name` being typed in the command position, or null. `end` runs to the end of the
 * name (not just the caret), so a pick replaces the whole name.
 */
export function activeCommandToken(text: string, caret: number): TriggerToken | null {
  const lead = /^\s*\//.exec(text);
  if (!lead) return null;
  const slash = lead[0].length - 1;
  if (caret <= slash) return null;
  const name = /^\S*/.exec(text.slice(slash + 1))?.[0] ?? '';
  const end = slash + 1 + name.length;
  // Past the name (a space was typed): the arguments are being written.
  if (caret > end) return null;
  // `//…` is the escape for a message that starts with "/"; `/api/users` is a path.
  if (name.includes('/')) return null;
  return { query: text.slice(slash + 1, caret), start: slash, end };
}

/** Commands for a typed name: id prefix first, then id substring, then the usage line; registry order within each. */
export function filterCommandEntries(entries: readonly ComposerHelpEntry[], query: string): readonly ComposerHelpEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const rank = (e: ComposerHelpEntry) => {
    const id = e.id.toLowerCase();
    if (id.startsWith(q)) return 0;
    if (id.includes(q)) return 1;
    return e.syntax.toLowerCase().includes(q) ? 2 : -1;
  };
  return entries
    .map((e) => ({ e, r: rank(e) }))
    .filter((s) => s.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((s) => s.e);
}

/**
 * How a pick edits the box: a runnable entry clears the typed `/name` (the host runs it);
 * any other replaces it with the entry's `insertText`, the caret after it.
 */
export function commandPickEdit(entry: ComposerHelpEntry, token: TriggerToken, text: string): TriggerEdit {
  const before = text.slice(0, token.start).trimStart();
  let after = text.slice(token.end);
  if (entry.runnable) {
    if (after.startsWith(' ')) after = after.slice(1);
    return { text: before + after, caret: before.length };
  }
  const insert = entry.insertText;
  if (insert.endsWith(' ') && after.startsWith(' ')) after = after.slice(1);
  return { text: before + insert + after, caret: before.length + insert.length };
}

export interface UseCommandAutocompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  /** The host's composer commands; absent ⇒ no `/` typeahead on this surface. */
  commands: PromptOptionsCommands | undefined;
  labels?: CommandAutocompleteLabels;
  disabled?: boolean;
}

const NO_ENTRIES: readonly ComposerHelpEntry[] = [];
const commandKey = (e: ComposerHelpEntry) => e.id;
const commandUnavailable = (e: ComposerHelpEntry) => !e.availability.ok;

export function useCommandAutocomplete(opts: UseCommandAutocompleteOptions): TriggerAutocomplete {
  const { textareaRef, value, setValue, commands, labels, disabled } = opts;
  const unavailable = labels?.unavailable ?? DEFAULT_COMMAND_LABELS.unavailable;
  const onChoose = commands?.onChoose;
  // The text edit already happened; only a runnable entry has anything left to do.
  const onPick = useCallback((entry: ComposerHelpEntry) => {
    if (entry.runnable) onChoose?.(entry.id);
  }, [onChoose]);
  const renderItem = useCallback((entry: ComposerHelpEntry): ReactNode => {
    const reason = entry.availability.ok ? undefined : entry.availability.reason;
    return (
      <>
        <span className="bf-cmp-typeahead__col">
          <span className="bf-cmp-typeahead__code">{entry.syntax}</span>
          <span className="bf-cmp-typeahead__detail" title={reason ?? entry.description}>{reason ?? entry.description}</span>
        </span>
        {reason !== undefined && <span className="bf-cmp-typeahead__tag">{unavailable}</span>}
      </>
    );
  }, [unavailable]);

  return useTriggerAutocomplete({
    textareaRef, value, setValue,
    enabled: !!commands && !disabled,
    detect: activeCommandToken,
    candidates: commands?.help.entries ?? NO_ENTRIES,
    filter: filterCommandEntries,
    itemKey: commandKey,
    renderItem,
    isDisabled: commandUnavailable,
    edit: commandPickEdit,
    onPick,
    listLabel: labels?.title ?? DEFAULT_COMMAND_LABELS.title,
    heading: labels?.title,
    emptyLabel: labels?.noMatches ?? DEFAULT_COMMAND_LABELS.noMatches,
  });
}
