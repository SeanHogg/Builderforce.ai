import { useCallback, useMemo, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BrainComposer, type BrainComposerLabels, type ComposerAddMenuItem as SharedAddMenuItem } from '@seanhogg/builderforce-brain-ui';
import { Icon } from '@/components/ui/Icon';
import { useAssistantGate } from '@/lib/academic/useAssistantGate';
import { AssessmentGateNotice, QueuedTurnsReceipt } from './chat-input/ComposerNotices';
import { ComposerSuggestions } from './chat-input/ComposerSuggestions';
import { useComposerStarters } from './chat-input/useComposerStarters';
import { useBrainComposerLabels } from './chat-input/useBrainComposerLabels';
import { useComposerAccount } from './chat-input/useComposerAccount';
import { useComposerOptions } from './chat-input/useComposerOptions';
import type { ChatInputAttachment, ChatInputProps } from './chat-input/types';
// The shell's own sheet — imported here so the composer renders right wherever it is
// dropped, not only beside a Brain panel.
import '@seanhogg/builderforce-brain-ui/styles.css';
export type { ChatModelOptions, ChatModelSelection } from '@seanhogg/builderforce-brain-ui';
export type { ChatInputAttachment, ChatInputProps, ComposerAddMenuItem, ComposerStarters, ComposerSuggestion } from './chat-input/types';

/** One stable empty list, so an omitted `pendingAttachments` never looks like a change. */
const NO_ATTACHMENTS: ChatInputAttachment[] = [];
/** What the `+` menu's file picker offers: originals, not pre-trimmed conversions. */
const ATTACH_ACCEPT = 'image/*,.pdf,.txt,.md,.csv,.tsv,.json,.docx,.rtf,.xlsx,.pptx';
const noop = () => {};

/**
 * The web's prompt area: a THIN adapter over the shared `BrainComposer` — the one
 * composer every BuilderForce surface (web Brain, canvas, VS Code, Rovr) mounts, with
 * its `+` menu, `/` Work panel and built-in Status tab. This file only maps the web's
 * long-standing `ChatInputProps` contract and next-intl copy onto it, and adds the
 * web's own facts: the exam gate, starting points, the queued-turns receipt.
 */
export function ChatInput(props: ChatInputProps) {
  const {
    value, onChange, onSubmit, placeholder, ariaLabel, disabled = false, submitLabel,
    running = false, onStop, queuedCount = 0, rows = 2, submitOnEnter = true,
    onAttach, onAddContext, webBrowsing, onWebBrowsingChange, accountSettingsHref,
    modeVocabulary, memoryUnavailableReason, showBrainIcon = false, showVoice = false,
    pendingAttachments = NO_ATTACHMENTS, onRemoveAttachment, secondaryContent,
    mentionables, onMention, ticketables, onTicketTag, contextControls, addMenuItems,
    starters, suggestions, account, className, focusToken,
  } = props;
  const t = useTranslations('chatInput');
  const router = useRouter();
  // THE exam gate (`lib/academic/assessment.ts`): a closed-book assessment live on the
  // board on stage refuses every turn from every composer — this one included.
  const gate = useAssistantGate();
  const closed = disabled || !gate.assistantAllowed;

  const options = useComposerOptions(props);
  const accountPort = useComposerAccount({ enabled: account !== null, projectId: account?.projectId ?? null });
  const bundle = useBrainComposerLabels(modeVocabulary);
  // The host's own words win where it has them: the verb on Send (the canvas names
  // its intent), and why memory is unavailable on this surface.
  const labels = useMemo<BrainComposerLabels>(() => (submitLabel || memoryUnavailableReason
    ? {
        ...bundle,
        composer: {
          ...bundle.composer,
          ...(submitLabel ? { send: submitLabel } : {}),
          ...(memoryUnavailableReason ? { memoryUnavailable: memoryUnavailableReason } : {}),
        },
      }
    : bundle), [bundle, submitLabel, memoryUnavailableReason]);

  // Starting points and next steps: the same two affordances on every prompt. The
  // catalogue opens from `+`; the chips stand down while it is open, while a turn
  // runs, and the moment there is text in the box.
  const starterControl = useComposerStarters(starters);
  const menuItems = useMemo<SharedAddMenuItem[] | undefined>(() => {
    const rows = starterControl.menuItem ? [starterControl.menuItem, ...(addMenuItems ?? [])] : addMenuItems;
    // A fragment, not the bare node: the shared menu's ReactNode comes from a second
    // copy of React's types, and only an element is assignable across the two.
    return rows?.map((row) => ({ ...row, icon: <>{row.icon}</> }));
  }, [starterControl.menuItem, addMenuItems]);
  const showSuggestions = !!suggestions?.length && !value.trim() && !running && !starterControl.open;
  const above = starterControl.catalog || showSuggestions
    ? <>{starterControl.catalog}{showSuggestions && <ComposerSuggestions items={suggestions!} />}</>
    : undefined;

  const attachFiles = useCallback((files: File[]) => {
    if (!onAttach) return;
    void (async () => { for (const file of files) await onAttach(file); })();
  }, [onAttach]);
  const attachments = useMemo(() => (onAttach
    ? {
        items: pendingAttachments.map((a) => ({ key: a.key, name: a.name })),
        onAdd: attachFiles,
        onRemove: onRemoveAttachment ?? noop,
        accept: ATTACH_ACCEPT,
      }
    : undefined), [onAttach, pendingAttachments, attachFiles, onRemoveAttachment]);
  const browsing = useMemo(
    () => (onWebBrowsingChange ? { on: !!webBrowsing, onChange: onWebBrowsingChange } : undefined),
    [webBrowsing, onWebBrowsingChange],
  );
  const openAccountSettings = useCallback(() => {
    if (accountSettingsHref) router.push(accountSettingsHref);
  }, [router, accountSettingsHref]);

  const context = contextControls || showBrainIcon
    ? (
      <>
        {contextControls}
        {showBrainIcon && (
          <Link href="/brainstorm" className="bf-cmp-iconbtn" title={t('brainstorm')} aria-label={t('brainstorm')}>
            <Icon name="message" size={20} />
          </Link>
        )}
      </>
    )
    : undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !closed) onSubmit();
  };

  return (
    // A form, so a host's submit (and assistive tech) reach the same one branch as
    // Enter and the Send button.
    <form onSubmit={handleSubmit} className={className}>
      <BrainComposer
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        running={running}
        onStop={onStop}
        disabled={closed}
        blockedNotice={<AssessmentGateNotice gate={gate} />}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        rows={rows}
        submitOnEnter={submitOnEnter}
        focusToken={focusToken}
        options={options}
        account={accountPort}
        onAccountSettings={accountSettingsHref ? openAccountSettings : undefined}
        attachments={attachments}
        onAddContext={onAddContext}
        webBrowsing={browsing}
        addMenuItems={menuItems}
        mentions={mentionables && mentionables.length > 0 && onMention ? { participants: mentionables, onPick: onMention } : undefined}
        tickets={ticketables && ticketables.length > 0 && onTicketTag ? { tickets: ticketables, onPick: onTicketTag } : undefined}
        voice={showVoice}
        context={context}
        above={above}
        below={queuedCount > 0 || secondaryContent
          ? (
            <>
              <QueuedTurnsReceipt count={queuedCount} />
              {secondaryContent && <div style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, flexWrap: 'wrap' }}>{secondaryContent}</div>}
            </>
          )
          : undefined}
        labels={labels}
      />
    </form>
  );
}
