import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PromptPanel, useMentionAutocomplete, useTicketAutocomplete } from '@seanhogg/builderforce-brain-ui';
import { Icon } from '@/components/ui/Icon';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';
import { iconButtonStyle, textareaStyle } from './chat-input/composerStyles';
import { ComposerAddMenu } from './chat-input/ComposerAddMenu';
import { ComposerOptionsMenu } from './chat-input/ComposerOptionsMenu';
import { ComposerPrimaryAction } from './chat-input/ComposerPrimaryAction';
import { AssessmentGateNotice, PendingAttachmentChips, QueuedTurnsReceipt } from './chat-input/ComposerNotices';
import { ComposerSendOrVoice } from './chat-input/ComposerSendOrVoice';
import { ComposerSuggestions } from './chat-input/ComposerSuggestions';
import { useComposerStarters } from './chat-input/useComposerStarters';
import { useAttachmentDropAndPaste } from './chat-input/useAttachmentDropAndPaste';
import type { ChatInputAttachment, ChatInputProps } from './chat-input/types';
// The shell's own sheet (the `/` trigger's quiet face) — imported here so the
// composer renders right wherever it is dropped, not only beside a Brain panel.
import '@seanhogg/builderforce-brain-ui/styles.css';
export type { ChatModelOptions, ChatModelSelection } from '@seanhogg/builderforce-brain-ui';
export type { ChatInputAttachment, ChatInputProps, ComposerAddMenuItem, ComposerStarters, ComposerSuggestion } from './chat-input/types';

/** One stable empty list, so an omitted `pendingAttachments` never looks like a change. */
const NO_ATTACHMENTS: ChatInputAttachment[] = [];
const noop = () => {};

/**
 * Reusable chat input: + attach, brain (ideation), voice (dictate), send arrow.
 * Use on Brain Storm, IDE chat, and any page that shows chats.
 */
export function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Message…',
  ariaLabel,
  disabled = false,
  submitLabel = 'Send',
  running = false,
  onStop,
  queuedCount = 0,
  rows = 2,
  submitOnEnter = true,
  onAttach,
  onAddContext,
  webBrowsing,
  onWebBrowsingChange,
  effort,
  onEffortChange,
  thinking,
  onThinkingChange,
  accountSettingsHref,
  modelSelection,
  modelOptions,
  onModelSelectionChange,
  effectiveModel,
  modelIdentity,
  chatMode,
  onChatModeChange,
  memoryEnabled,
  onMemoryChange,
  memoryUnavailableReason,
  canConsolidate = false,
  consolidating = false,
  forking = false,
  onConsolidate,
  onFork,
  autoMode,
  onAutoModeChange,
  showBrainIcon = false,
  showVoice = false,
  pendingAttachments = NO_ATTACHMENTS,
  onRemoveAttachment,
  secondaryContent,
  mentionables,
  onMention,
  ticketables,
  onTicketTag,
  contextControls,
  addMenuItems,
  starters,
  suggestions,
  menuStatus,
  modeVocabulary,
  className,
  focusToken,
}: ChatInputProps) {
  const t = useTranslations('chatInput');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs
  valueRef.current = value;
  // Dictation reads the text at the moment a phrase lands; a stable reader keeps
  // the voice button out of every keystroke's render.
  const getValue = useCallback(() => valueRef.current, []);
  const [focused, setFocused] = useState(false);
  // Externally-seeded text: focus and drop the caret at the end so the user
  // continues the sentence instead of sending the seed verbatim.
  useEffect(() => {
    if (focusToken == null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [focusToken]);
  // THE exam gate (`lib/academic/assessment.ts`): a closed-book assessment live on the
  // board on stage refuses every turn from every composer — this one included.
  const gate = useAssistantGate();
  const canSubmit = value.trim().length > 0 && !disabled && gate.assistantAllowed;
  // "Activated" once the user is typing in / focused on the composer — the whole
  // box lights up in accent (blue), the same treatment as the VS Code composer so
  // the experience matches across every modality.
  const active = focused || value.trim().length > 0;

  // Rows, top to bottom: the textarea (full width, so typed text is never crushed
  // into a sliver), then one row of tools — `+`, `/`, who answers and what is
  // addressed — with the one trailing button pinned right. The shell owns the rows;
  // this file only says which control is which kind.

  // @-mention typeahead — active only when the host supplies participants. Picking
  // one routes the next turn (via onMention) and strips the "@query" from the text.
  // Works in every modality: the participant set comes from the chat, not the persona.
  const mention = useMentionAutocomplete({
    textareaRef,
    value,
    setValue: onChange,
    participants: mentionables ?? [],
    onPick: onMention ?? noop,
    disabled,
    labels: { title: t('mentionTitle'), agent: t('mentionAgent'), human: t('mentionHuman') },
  });

  // #-ticket typeahead — active when ticketables are provided. Picking one replaces
  // "#query" with the ticket ref and calls onTicketTag.
  const ticket = useTicketAutocomplete({
    textareaRef,
    value,
    setValue: onChange,
    tickets: ticketables ?? [],
    onPick: onTicketTag ?? noop,
    disabled,
    labels: { title: t('ticketTagTitle'), status: t('ticketTagStatus'), noMatches: t('ticketTagNoMatches') },
  });

  const attachHandlers = useAttachmentDropAndPaste(onAttach);

  // Starting points and next steps: the same two affordances on every prompt. The
  // catalogue opens from `+`; the chips stand down while it is open, while a turn runs,
  // and the moment there is text in the box.
  const starterControl = useComposerStarters(starters);
  const menuItems = useMemo(
    () => (starterControl.menuItem ? [starterControl.menuItem, ...(addMenuItems ?? [])] : addMenuItems),
    [starterControl.menuItem, addMenuItems],
  );
  const showSuggestions = !!suggestions?.length && !value.trim() && !running && !starterControl.open;
  const attachmentChips = pendingAttachments.length > 0 && onRemoveAttachment
    ? <PendingAttachmentChips attachments={pendingAttachments} onRemove={onRemoveAttachment} />
    : null;
  const status = starterControl.catalog || showSuggestions || attachmentChips
    ? <>
      {starterControl.catalog}
      {showSuggestions && <ComposerSuggestions items={suggestions!} />}
      {attachmentChips}
    </>
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The @-mention picker gets first refusal on nav/select/escape keys.
    if (mention.onKeyDown(e)) return;
    // The #ticket picker gets next refusal.
    if (ticket.onKeyDown(e)) return;
    if (submitOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
    // Shift+Enter (or Enter when a host turns submitOnEnter off) adds a new line.
  };

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <form onSubmit={handleSubmit} className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--chat-ctl-gap, 6px)' }}>
      <AssessmentGateNotice gate={gate} />
      <PromptPanel
        active={active}
        onDrop={attachHandlers.onDrop}
        onDragOver={attachHandlers.onDragOver}
        overlay={ticket.open ? ticket.popup : mention.popup}
        status={status}
        input={(
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={() => { mention.onSelect(); ticket.onSelect(); }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPaste={attachHandlers.onPaste}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            disabled={disabled || !gate.assistantAllowed}
            rows={rows}
            style={textareaStyle}
          />
        )}
        // A fragment, not the bare node: the shell's ReactNode comes from a second copy
        // of React's types, and only an element is assignable across the two.
        // The shell carries it in the tool row, after `+` and `/`.
        context={contextControls ? <>{contextControls}</> : undefined}
        actions={(
          <>
            <ComposerAddMenu
              onAttach={onAttach}
              onAddContext={onAddContext}
              items={menuItems}
              webBrowsing={webBrowsing}
              onWebBrowsingChange={onWebBrowsingChange}
              disabled={disabled}
            />
            <ComposerOptionsMenu
              disabled={disabled}
              effort={effort}
              onEffortChange={onEffortChange}
              thinking={thinking}
              onThinkingChange={onThinkingChange}
              accountSettingsHref={accountSettingsHref}
              modelSelection={modelSelection}
              modelOptions={modelOptions}
              onModelSelectionChange={onModelSelectionChange}
              effectiveModel={effectiveModel}
              modelIdentity={modelIdentity}
              chatMode={chatMode}
              onChatModeChange={onChatModeChange}
              modeVocabulary={modeVocabulary}
              memoryEnabled={memoryEnabled}
              onMemoryChange={onMemoryChange}
              memoryUnavailableReason={memoryUnavailableReason}
              canConsolidate={canConsolidate}
              consolidating={consolidating}
              forking={forking}
              onConsolidate={onConsolidate}
              onFork={onFork}
              autoMode={autoMode}
              onAutoModeChange={onAutoModeChange}
              status={menuStatus}
            />
            {showBrainIcon && (
              <Link
                href="/brainstorm"
                style={iconButtonStyle(false)}
                title={t('brainstorm')}
              >
                <Icon name="message" size={20} />
              </Link>
            )}
          </>
        )}
        // Send/Stop is handed to the shell's trailing slot, which pins it to the far
        // right edge — the same placement the editor composer now gets from the same
        // prop, instead of each surface anchoring it by hand. With voice on, the mic
        // shares that slot: it shows while there is nothing to send or stop.
        primaryAction={showVoice
          ? <ComposerSendOrVoice running={running} onStop={onStop} canSubmit={canSubmit} submitLabel={submitLabel} getValue={getValue} onChange={onChange} disabled={disabled} />
          : <ComposerPrimaryAction running={running} onStop={onStop} canSubmit={canSubmit} submitLabel={submitLabel} />}
      />
      <QueuedTurnsReceipt count={queuedCount} />
      {secondaryContent && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {secondaryContent}
        </div>
      )}
    </form>
  );
}
