import { useRef, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PromptPanel, useMentionAutocomplete, useTicketAutocomplete } from '@seanhogg/builderforce-brain-ui';
import { PlanBadge } from '@/components/PlanBadge';
import { Icon } from '@/components/ui/Icon';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';
import { iconButtonStyle, textareaStyle } from './chat-input/composerStyles';
import { ComposerAddMenu } from './chat-input/ComposerAddMenu';
import { ComposerOptionsMenu } from './chat-input/ComposerOptionsMenu';
import { ComposerPrimaryAction } from './chat-input/ComposerPrimaryAction';
import { AssessmentGateNotice, PendingAttachmentChips, QueuedTurnsReceipt } from './chat-input/ComposerNotices';
import { VoiceDictationButton } from './chat-input/VoiceDictationButton';
import { useAttachmentDropAndPaste } from './chat-input/useAttachmentDropAndPaste';
import type { ChatInputAttachment, ChatInputProps } from './chat-input/types';
import compactStyles from './chat-input/composerCompact.module.css';
export type { ChatModelOptions, ChatModelSelection } from '@seanhogg/builderforce-brain-ui';
export type { ChatInputAttachment, ChatInputProps, ComposerAddMenuItem } from './chat-input/types';

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
  submitOnEnter = false,
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
  contextPlacement = 'row',
  addMenuItems,
  meta,
  density = 'comfortable',
  modeVocabulary,
  className,
  focusToken,
}: ChatInputProps) {
  const compact = density === 'compact';
  const contextInTools = compact || contextPlacement === 'tools';
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
  // into a sliver), the context row (who answers, what is addressed), the tools
  // with Send pinned right, and the standing facts (plan, memory). The shell owns
  // the rows; this file only says which control is which kind.

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
    // When submitOnEnter is false, Enter adds a new line (default textarea behavior); only Up arrow submits
  };

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <form onSubmit={handleSubmit} className={[className, compact && compactStyles.compact].filter(Boolean).join(' ') || undefined} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--chat-ctl-gap, 6px)' }}>
      <AssessmentGateNotice gate={gate} />
      <PromptPanel
        active={active}
        onDrop={attachHandlers.onDrop}
        onDragOver={attachHandlers.onDragOver}
        overlay={ticket.open ? ticket.popup : mention.popup}
        status={pendingAttachments.length > 0 && onRemoveAttachment
          ? <PendingAttachmentChips attachments={pendingAttachments} onRemove={onRemoveAttachment} />
          : undefined}
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
        context={contextControls && !contextInTools ? <>{contextControls}</> : undefined}
        // Which plan is funding this chat (and, when metered, what allowance is
        // left), then the host's own standing facts. Self-gating: the chip renders
        // nothing without a tenant session. Compact hosts show the plan themselves.
        meta={compact ? undefined : (
          <>
            <PlanBadge />
            {meta}
          </>
        )}
        actions={(
          <>
            <ComposerAddMenu
              onAttach={onAttach}
              onAddContext={onAddContext}
              items={addMenuItems}
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
            {contextInTools && contextControls}
            {showVoice && <VoiceDictationButton getValue={getValue} onChange={onChange} disabled={disabled} />}
          </>
        )}
        // Send/Stop is handed to the shell's trailing slot, which pins it to the far
        // right edge — the same placement the editor composer now gets from the same
        // prop, instead of each surface anchoring it by hand.
        primaryAction={<ComposerPrimaryAction running={running} onStop={onStop} canSubmit={canSubmit} submitLabel={submitLabel} />}
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
