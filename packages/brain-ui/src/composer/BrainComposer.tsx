/**
 * THE prompt area — one component for every BuilderForce surface: the web Brain, the
 * creation canvas, the VS Code panel and Rovr. The shell (`PromptPanel`), the text box
 * with its @-mention and #-ticket pickers, the `+` menu, the `/` Work panel (Mode,
 * Effort, Model and the shared Status tab) and the one trailing button live here, so a
 * surface can no longer grow a composer that differs from the others.
 *
 * Hosts supply STATE and PORTS, never controls: the text and its submit/stop, the
 * run-shaping options (`ComposerOptions`), attachments, the request port the Status tab
 * reads through, and their localized copy. Anything host-specific that genuinely is a
 * control (who answers, who is addressed) arrives as `context`; anything shown above
 * the text (queued turns, starters) as `status`.
 */
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { PromptPanel } from '../PromptPanel';
import { PromptOptionsMenu } from '../promptOptions/PromptOptionsMenu';
import type { PromptOptionsLabels } from '../promptOptions/types';
import { useMentionAutocomplete, type UseMentionAutocompleteOptions } from '../mention/MentionAutocomplete';
import { useTicketAutocomplete, type UseTicketAutocompleteOptions } from '../mention/TicketAutocomplete';
import { WorkStatusPanel } from '../workStatus/WorkStatusPanel';
import type { JsonRequest } from '../workStatus/consumptionSnapshot';
import type { UpgradeTarget } from '../workStatus/AccountStatus';
import type { WorkStatusLabels } from '../workStatus/labels';
import type { SpendLabels } from '../spend/labels';
import { ComposerAddMenu, type ComposerAddMenuItem } from './ComposerAddMenu';
import { ComposerTrailingButton } from './ComposerTrailingButton';
import { AttachmentChips, type ComposerAttachment } from './AttachmentChips';
import { composerOptionGroups, type ComposerOptions } from './composerOptions';
import { composerLabels, type ComposerLabels } from './labels';

export interface BrainComposerLabels {
  composer?: Partial<ComposerLabels>;
  options?: Partial<PromptOptionsLabels>;
  status?: Partial<WorkStatusLabels>;
  spend?: Partial<SpendLabels>;
  mention?: UseMentionAutocompleteOptions['labels'];
  ticket?: UseTicketAutocompleteOptions['labels'];
}

export interface BrainComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** A run is streaming: Send queues behind it, an empty box offers Stop. */
  running?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  /** Why the box is closed to input (an exam in progress, …) — shown above it. */
  blockedNotice?: ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  submitOnEnter?: boolean;
  /** Bump to focus the box and put the caret at the end (a seeded prompt). */
  focusToken?: number;
  /** Run shaping for the `/` Work panel. */
  options: ComposerOptions;
  /** The Status tab's data port; omit on a surface with no account behind it (a guest). */
  account?: {
    request: JsonRequest;
    projectId: number | null;
    locale?: string;
    onUpgrade?: (target: UpgradeTarget) => void;
  };
  onAccountSettings?: () => void;
  attachments?: {
    items: readonly ComposerAttachment[];
    onAdd: (files: File[]) => void;
    onRemove: (key: string) => void;
    uploading?: boolean;
    accept?: string;
  };
  onAddContext?: () => void;
  webBrowsing?: { on: boolean; onChange: (on: boolean) => void };
  addMenuItems?: readonly ComposerAddMenuItem[];
  mentions?: Pick<UseMentionAutocompleteOptions, 'participants' | 'onPick'>;
  tickets?: Pick<UseTicketAutocompleteOptions, 'tickets' | 'onPick'>;
  /** Close the @-mention and #-ticket pickers while the box stays open (e.g. mid-run
   *  with nobody else to address). Always closed while `disabled`. */
  pickersDisabled?: boolean;
  /** Offer dictation in the trailing slot when the runtime can listen. */
  voice?: boolean;
  /** Who answers / who is addressed — rides the tool row after `+` and `/`. */
  context?: ReactNode;
  /** Shown above the text (queued turns, starters, suggestions). */
  above?: ReactNode;
  /** Shown under the box (a queued-turns receipt, a secondary link). */
  below?: ReactNode;
  labels?: BrainComposerLabels;
  className?: string;
}

const NO_PARTICIPANTS: UseMentionAutocompleteOptions['participants'] = [];
const NO_TICKETS: UseTicketAutocompleteOptions['tickets'] = [];
const noop = () => undefined;

export function BrainComposer(props: BrainComposerProps) {
  const {
    value, onChange, onSubmit, running = false, onStop, disabled = false, blockedNotice,
    placeholder, ariaLabel, rows = 2, submitOnEnter = true, focusToken, options, account,
    onAccountSettings, attachments, onAddContext, webBrowsing, addMenuItems, mentions, tickets,
    pickersDisabled = false, voice = false, context, above, below, labels: labelBundle, className,
  } = props;
  const labels = composerLabels(labelBundle?.composer);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const getValue = useCallback(() => valueRef.current, []);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (focusToken == null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusToken]);

  const mention = useMentionAutocomplete({
    textareaRef, value, setValue: onChange, participants: mentions?.participants ?? NO_PARTICIPANTS,
    onPick: mentions?.onPick ?? noop, disabled: disabled || pickersDisabled, labels: labelBundle?.mention,
  });
  const ticket = useTicketAutocomplete({
    textareaRef, value, setValue: onChange, tickets: tickets?.tickets ?? NO_TICKETS,
    onPick: tickets?.onPick ?? noop, disabled: disabled || pickersDisabled, labels: labelBundle?.ticket,
  });

  const canSubmit = value.trim().length > 0 && !disabled;
  const submit = () => { if (canSubmit) onSubmit(); };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!attachments) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); attachments.onAdd(files); }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragging(false);
    if (!attachments) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) { e.preventDefault(); attachments.onAdd(files); }
  };

  const groups = composerOptionGroups(options, labels);
  const statusNode = account
    ? (
      <WorkStatusPanel
        request={account.request}
        projectId={account.projectId}
        labels={labelBundle?.status}
        spendLabels={labelBundle?.spend}
        locale={account.locale}
        onUpgrade={account.onUpgrade}
      />
    )
    : undefined;

  const chips = attachments ? <AttachmentChips items={attachments.items} onRemove={attachments.onRemove} labels={labels} /> : null;
  const aboveBox = above || (attachments && attachments.items.length > 0) ? <>{above}{chips}</> : undefined;

  return (
    <div className={['bf-cmp', className].filter(Boolean).join(' ')}>
      {blockedNotice}
      <PromptPanel
        active={focused || value.trim().length > 0}
        dragging={dragging}
        onDragOver={attachments ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
        onDragLeave={attachments ? () => setDragging(false) : undefined}
        onDrop={attachments ? onDrop : undefined}
        overlay={ticket.open ? ticket.popup : mention.popup}
        status={aboveBox}
        input={(
          <textarea
            ref={textareaRef}
            className="bf-cmp-input"
            rows={rows}
            value={value}
            placeholder={placeholder ?? labels.placeholder}
            aria-label={ariaLabel ?? placeholder ?? labels.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={onPaste}
            onSelect={() => { mention.onSelect(); ticket.onSelect(); }}
            onKeyDown={(e) => {
              if (mention.onKeyDown(e)) return;
              if (ticket.onKeyDown(e)) return;
              if (submitOnEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
        actions={(
          <>
            <ComposerAddMenu
              labels={labels}
              disabled={disabled}
              onAttachFiles={attachments?.onAdd}
              uploading={attachments?.uploading}
              accept={attachments?.accept}
              onAddContext={onAddContext}
              webBrowsing={webBrowsing}
              items={addMenuItems}
            />
            <PromptOptionsMenu
              labels={labelBundle?.options}
              disabled={disabled}
              {...groups}
              status={statusNode}
              onAccountSettings={onAccountSettings}
            />
          </>
        )}
        context={context ? <>{context}</> : undefined}
        primaryAction={(
          <ComposerTrailingButton
            labels={labels}
            canSubmit={canSubmit}
            running={running}
            disabled={disabled}
            onSend={submit}
            onStop={onStop}
            voice={voice ? { getValue, setValue: onChange } : undefined}
          />
        )}
      />
      {below}
    </div>
  );
}
