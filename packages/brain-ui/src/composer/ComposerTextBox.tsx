import { memo, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { useDraftText, type ComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import { useMentionAutocomplete, type UseMentionAutocompleteOptions } from '../mention/MentionAutocomplete';
import { useTicketAutocomplete, type UseTicketAutocompleteOptions } from '../mention/TicketAutocomplete';
import { UNUSED_STORE } from './unusedDraftStore';

/**
 * Where the composer's text comes from: a {@link ComposerDraftStore} (the box subscribes to it, the host never
 * re-renders on a key) or a controlled `value`/`onChange` pair (the host owns the text as React state). Exactly one.
 */
export type ComposerTextSource =
  | { draftStore: ComposerDraftStore; value?: undefined; onChange?: undefined }
  | { draftStore?: undefined; value: string; onChange: (value: string) => void };

const noop = () => undefined;

export type ComposerTextBoxProps = ComposerTextSource & {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  rows: number;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  submitOnEnter: boolean;
  /** A run is streaming (Alt+Enter holds the message for after it, where the host offers that). */
  running: boolean;
  /** The host offers an explicit "Queue for after". */
  canQueue: boolean;
  /** The gated submit / queue - stable identities: the box must not re-render because the frame did. */
  onSubmit: () => void;
  onQueue: () => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  mentions: Pick<UseMentionAutocompleteOptions, 'participants' | 'onPick'> | undefined;
  tickets: Pick<UseTicketAutocompleteOptions, 'tickets' | 'onPick'> | undefined;
  pickersDisabled: boolean;
  mentionLabels: UseMentionAutocompleteOptions['labels'];
  ticketLabels: UseTicketAutocompleteOptions['labels'];
};

const NO_PARTICIPANTS: UseMentionAutocompleteOptions['participants'] = [];
const NO_TICKETS: UseTicketAutocompleteOptions['tickets'] = [];

/**
 * The textarea and its @-mention / #-ticket typeahead - the ONLY part of the composer that depends on the text, so
 * the only part that re-renders per key. Its popups are absolutely placed against the prompt panel, so they render
 * beside the textarea here instead of in a slot of the frame (which would re-render the frame per key to fill it).
 */
function ComposerTextBoxInner(props: ComposerTextBoxProps) {
  const {
    textareaRef, rows, placeholder, ariaLabel, disabled, submitOnEnter, running, canQueue, onSubmit, onQueue, onPaste,
    onFocus, onBlur, mentions, tickets, pickersDisabled, mentionLabels, ticketLabels, draftStore, onChange,
  } = props;
  const storeText = useDraftText(draftStore ?? UNUSED_STORE);
  const value = draftStore ? storeText : props.value ?? '';
  const setValue = draftStore ? draftStore.set : onChange ?? noop;

  const mention = useMentionAutocomplete({
    textareaRef, value, setValue, participants: mentions?.participants ?? NO_PARTICIPANTS,
    onPick: mentions?.onPick ?? noop, disabled: disabled || pickersDisabled, labels: mentionLabels,
  });
  const ticket = useTicketAutocomplete({
    textareaRef, value, setValue, tickets: tickets?.tickets ?? NO_TICKETS,
    onPick: tickets?.onPick ?? noop, disabled: disabled || pickersDisabled, labels: ticketLabels,
  });

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.onKeyDown(e)) return;
    if (ticket.onKeyDown(e)) return;
    if (submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // Alt+Enter mid-run: hold it for after the run, where the host offers that.
      if (e.altKey && running && canQueue) onQueue();
      else onSubmit();
    }
  };

  return (
    <>
      {ticket.open ? ticket.popup : mention.popup}
      <textarea
        ref={textareaRef}
        className="bf-cmp-input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onPaste={onPaste}
        onSelect={() => { mention.onSelect(); ticket.onSelect(); }}
        onKeyDown={onKeyDown}
      />
    </>
  );
}

export const ComposerTextBox = memo(ComposerTextBoxInner);
