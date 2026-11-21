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
import { DEFAULT_PROMPT_OPTIONS_LABELS, type PromptOptionsLabels } from '../promptOptions/types';
import { useTriggerAutocomplete, type TriggerAutocomplete, type TriggerEdit, type TriggerToken } from './useTriggerAutocomplete';

/** The `/` typeahead's OWN copy (`command.<key>`); the rest is the Actions tab's, which it mirrors. */
export interface CommandAutocompleteLabels {
  /** The row shown when no command matches what was typed. */
  noMatches?: string;
}

/** English defaults for a host catalog's missing fields. */
export const DEFAULT_COMMAND_LABELS: Required<CommandAutocompleteLabels> = {
  noMatches: 'No matching commands',
};

/** Everything the `/` popup reads: its own copy plus the `/` menu's Actions-tab words for the same things. */
export type CommandTypeaheadLabels = CommandAutocompleteLabels
  & Partial<Pick<PromptOptionsLabels, 'actionsTab' | 'actionsEmpty' | 'commandUnavailable'>>;

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

/**
 * Commands for a typed name: the exact id first, then id prefix, then id substring, then the usage line;
 * registry order within each.
 */
export function filterCommandEntries(entries: readonly ComposerHelpEntry[], query: string): readonly ComposerHelpEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const rank = (e: ComposerHelpEntry) => {
    const id = e.id.toLowerCase();
    if (id === q) return 0;
    if (id.startsWith(q)) return 1;
    if (id.includes(q)) return 2;
    return e.syntax.toLowerCase().includes(q) ? 3 : -1;
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

/**
 * Enter on a command this surface cannot run: the line becomes the full `/<id>` (not the partial name typed) and is
 * submitted, so the host answers with why it is unavailable.
 */
export function commandDisabledEnterEdit(entry: ComposerHelpEntry, token: TriggerToken, text: string): TriggerEdit {
  const before = text.slice(0, token.start).trimStart();
  const line = `/${entry.id}`;
  return { text: before + line + text.slice(token.end), caret: before.length + line.length };
}

export interface UseCommandAutocompleteOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  /** The host's composer commands; absent ⇒ no `/` typeahead on this surface. */
  commands: PromptOptionsCommands | undefined;
  labels?: CommandTypeaheadLabels;
  disabled?: boolean;
}

const NO_ENTRIES: readonly ComposerHelpEntry[] = [];
const commandKey = (e: ComposerHelpEntry) => e.id;
const commandUnavailable = (e: ComposerHelpEntry) => !e.availability.ok;

export function useCommandAutocomplete(opts: UseCommandAutocompleteOptions): TriggerAutocomplete {
  const { textareaRef, value, setValue, commands, labels, disabled } = opts;
  const unavailable = labels?.commandUnavailable ?? DEFAULT_PROMPT_OPTIONS_LABELS.commandUnavailable;
  const title = labels?.actionsTab ?? DEFAULT_PROMPT_OPTIONS_LABELS.actionsTab;
  const candidates = commands?.help.entries ?? NO_ENTRIES;
  // No command registered at all says so; a name that matches none says that instead.
  const emptyLabel = candidates.length === 0
    ? labels?.actionsEmpty ?? DEFAULT_PROMPT_OPTIONS_LABELS.actionsEmpty
    : labels?.noMatches ?? DEFAULT_COMMAND_LABELS.noMatches;
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
    candidates,
    filter: filterCommandEntries,
    itemKey: commandKey,
    renderItem,
    isDisabled: commandUnavailable,
    edit: commandPickEdit,
    onPick,
    listLabel: title,
    heading: title,
    emptyLabel,
    // `/` was typed in the command position: even "no commands here" is worth saying.
    openWithoutCandidates: true,
    disabledEnterEdit: commandDisabledEnterEdit,
  });
}
