/**
 * #ticket autocomplete — the composer trigger that lets a user tag a ticket in the chat
 * by typing "#". A thin adapter over {@link useTriggerAutocomplete}: the token grammar
 * and ranking are brain-embedded's (`activeTicketToken` / `filterTicketCandidates`), and
 * a pick replaces the "#query" fragment with the ticket's reference ("#ABC-123" or
 * "#123") and calls `onPick`.
 */
import { useCallback, type ReactNode, type RefObject } from 'react';
import {
  activeTicketToken,
  filterTicketCandidates,
  type ChatTicket as TicketTag,
} from '@seanhogg/builderforce-brain-embedded';
import { useTriggerAutocomplete, type TriggerAutocomplete, type TriggerEdit, type TriggerToken } from './useTriggerAutocomplete';

export interface TicketAutocompleteLabels {
  /** Heading above the list, e.g. "Tag ticket". */
  title?: string;
  /** What a row's status tag is (its tooltip prefix), e.g. "Status". */
  status?: string;
  /** Text when no tickets match. */
  noMatches?: string;
}

/** English defaults for a host catalog's missing fields. */
export const DEFAULT_TICKET_TAG_LABELS: Required<TicketAutocompleteLabels> = { title: 'Tag ticket', status: 'Status', noMatches: 'No tickets found' };

export interface UseTicketAutocompleteOptions {
  /** Ref to the composer's <textarea> — read for the live caret position. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Current composer text (controlled). */
  value: string;
  /** Setter for the composer text (same one the textarea's onChange calls). */
  setValue: (v: string) => void;
  /** The available tickets to choose from. */
  tickets: TicketTag[];
  /** Called with the ticket the user picked. */
  onPick: (t: TicketTag) => void;
  labels?: TicketAutocompleteLabels;
  /** Suppress the picker entirely (e.g. while a run is streaming, or no source here). */
  disabled?: boolean;
}

const ticketRef = (t: TicketTag) => t.key ?? String(t.id);
const ticketFilter = (all: readonly TicketTag[], query: string) => filterTicketCandidates(all as TicketTag[], query);

/** A pick replaces "#query" with "#ref" and a space (unless whitespace already follows); the caret lands after them. */
export function ticketPickEdit(t: TicketTag, token: TriggerToken, text: string): TriggerEdit {
  const after = text.slice(token.end);
  const tag = `#${ticketRef(t)}${/^\s/.test(after) ? '' : ' '}`;
  return { text: text.slice(0, token.start) + tag + after, caret: token.start + tag.length };
}

export function useTicketAutocomplete(opts: UseTicketAutocompleteOptions): TriggerAutocomplete {
  const { textareaRef, value, setValue, tickets, onPick, labels, disabled } = opts;
  const statusLabel = labels?.status ?? DEFAULT_TICKET_TAG_LABELS.status;
  const renderItem = useCallback((t: TicketTag): ReactNode => (
    <>
      <span className="bf-cmp-typeahead__code">#{ticketRef(t)}</span>
      <span className="bf-cmp-typeahead__title">{t.title}</span>
      {t.status && <span className="bf-cmp-typeahead__tag" title={`${statusLabel}: ${t.status}`}>{t.status}</span>}
    </>
  ), [statusLabel]);

  return useTriggerAutocomplete({
    textareaRef, value, setValue,
    enabled: !disabled,
    detect: activeTicketToken,
    candidates: tickets,
    filter: ticketFilter,
    itemKey: ticketRef,
    renderItem,
    edit: ticketPickEdit,
    onPick,
    listLabel: labels?.title ?? DEFAULT_TICKET_TAG_LABELS.title,
    heading: labels?.title,
    emptyLabel: labels?.noMatches ?? DEFAULT_TICKET_TAG_LABELS.noMatches,
  });
}
