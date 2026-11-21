/**
 * @-mention autocomplete — the composer trigger that lets a user direct the next chat
 * turn at an invited participant (an agent OR a person) by typing "@". A thin adapter
 * over {@link useTriggerAutocomplete}: the token grammar and ranking are brain-embedded's
 * (`activeMentionToken` / `filterMentionCandidates`), and a pick strips the "@query"
 * fragment (the picked recipient shows in the composer's "To:" chip, so it need not
 * linger in the body) and calls `onPick` — wire that to `useRecipientChoice`'s `choose`.
 */
import { useCallback, type ReactNode, type RefObject } from 'react';
import {
  activeMentionToken,
  filterMentionCandidates,
  type DirectedRecipient,
} from '@seanhogg/builderforce-brain-embedded';
import { Avatar } from '../ParticipantBadge';
import { useTriggerAutocomplete, type TriggerAutocomplete, type TriggerEdit, type TriggerToken } from './useTriggerAutocomplete';

export interface MentionLabels {
  /** Heading above the list, e.g. "Direct to". */
  title?: string;
  /** Row sub-label for an invited agent, e.g. "Agent". */
  agent?: string;
  /** Row sub-label for an invited person, e.g. "Person". */
  human?: string;
  /** The row shown when nobody matches (or nobody is addressable here). */
  noMatches?: string;
}

/** English defaults — the fallback for any field a host catalog lacks. */
export const DEFAULT_MENTION_LABELS: Required<MentionLabels> = {
  title: 'Direct to',
  agent: 'Agent',
  human: 'Person',
  noMatches: 'No one to direct to',
};

export interface UseMentionAutocompleteOptions {
  /** Ref to the composer's <textarea> — read for the live caret position. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Current composer text (controlled). */
  value: string;
  /** Setter for the composer text (same one the textarea's onChange calls). */
  setValue: (v: string) => void;
  /** The chat's invited participants (agents + humans) offered by the picker. */
  participants: DirectedRecipient[];
  /** Called with the participant the user picked — wire to `useRecipientChoice`'s `choose`. */
  onPick: (r: DirectedRecipient) => void;
  labels?: MentionLabels;
  /**
   * An optional one-line signal shown under a participant's name (the host decides what —
   * the web app passes a trait summary). Called per rendered row, so it must be a cheap
   * lookup into data the host already holds, never a fetch.
   */
  detail?: (r: DirectedRecipient) => string | undefined;
  /** Suppress the picker entirely (e.g. while a run is streaming, or no source here). */
  disabled?: boolean;
}

const mentionFilter = (all: readonly DirectedRecipient[], query: string) => filterMentionCandidates(all as DirectedRecipient[], query);
const mentionKey = (r: DirectedRecipient) => `${r.kind}:${r.ref}`;

/** A pick strips "@query" and one trailing space; the caret stays where the token was. */
export function mentionPickEdit(_r: DirectedRecipient, token: TriggerToken, text: string): TriggerEdit {
  let after = text.slice(token.end);
  if (after.startsWith(' ')) after = after.slice(1);
  return { text: text.slice(0, token.start) + after, caret: token.start };
}

export function useMentionAutocomplete(opts: UseMentionAutocompleteOptions): TriggerAutocomplete {
  const { textareaRef, value, setValue, participants, onPick, labels, disabled, detail } = opts;
  const renderItem = useCallback((m: DirectedRecipient): ReactNode => {
    const sub = detail?.(m);
    return (
      <>
        <Avatar name={m.name} kind={m.kind} size={20} />
        <span className="bf-cmp-typeahead__col">
          <span className="bf-cmp-typeahead__name">{m.name}</span>
          {sub && <span className="bf-cmp-typeahead__detail">{sub}</span>}
        </span>
        <span className="bf-cmp-typeahead__tag">
          {m.kind === 'agent' ? (labels?.agent ?? DEFAULT_MENTION_LABELS.agent) : (labels?.human ?? DEFAULT_MENTION_LABELS.human)}
        </span>
      </>
    );
  }, [detail, labels?.agent, labels?.human]);

  return useTriggerAutocomplete({
    textareaRef, value, setValue,
    enabled: !disabled,
    detect: activeMentionToken,
    candidates: participants,
    filter: mentionFilter,
    itemKey: mentionKey,
    renderItem,
    edit: mentionPickEdit,
    onPick,
    listLabel: labels?.title ?? DEFAULT_MENTION_LABELS.title,
    heading: labels?.title,
    emptyLabel: labels?.noMatches ?? DEFAULT_MENTION_LABELS.noMatches,
  });
}
