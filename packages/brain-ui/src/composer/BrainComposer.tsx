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
import { promptOptionsLabels, type PromptOptionsLabels } from '../promptOptions/types';
import { InferenceModeFirstRun } from '../inferenceMode/InferenceModeFirstRun';
import { useInferenceModeGate, type InferenceModeGate } from '../inferenceMode/useInferenceModeGate';
import { useMentionAutocomplete, type UseMentionAutocompleteOptions } from '../mention/MentionAutocomplete';
import { useTicketAutocomplete, type UseTicketAutocompleteOptions } from '../mention/TicketAutocomplete';
import { WorkStatusPanel } from '../workStatus/WorkStatusPanel';
import { WorkSpendPanel } from '../workStatus/WorkSpendPanel';
import { spendLabels } from '../spend/labels';
import { workStatusLabels } from '../workStatus/labels';
import type { JsonRequest } from '../workStatus/consumptionSnapshot';
import type { UpgradeTarget } from '../workStatus/AccountStatus';
import type { WorkStatusLabels } from '../workStatus/labels';
import type { SpendLabels } from '../spend/labels';
import { ComposerAddMenu, type ComposerAddMenuItem } from './ComposerAddMenu';
import { ComposerTrailingButton } from './ComposerTrailingButton';
import { AttachmentChips, type ComposerAttachment } from './AttachmentChips';
import { composerOptionGroups, type ComposerOptions } from './composerOptions';
import { SuggestionRow, type ComposerSuggestion } from './SuggestionRow';
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
  /**
   * The explicit "Queue for after" while a run is going (Alt+Enter), for a host whose
   * Send STEERS the running turn instead of queueing behind it. Omitted ⇒ Alt+Enter sends.
   */
  onQueue?: () => void;
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
  /** Shown above the text (queued turns, starters). */
  above?: ReactNode;
  /**
   * Fixed next steps as chips (never a model call). The composer decides WHEN: only over
   * an empty box with no turn running — so every host shows them the same way.
   */
  suggestions?: { items: readonly ComposerSuggestion[]; label: string };
  /** Shown under the box (a queued-turns receipt, a secondary link). */
  below?: ReactNode;
  /**
   * The first-run gate, when the HOST owns it (`useInferenceModeGate`) because it also
   * starts turns itself — the guest panel's landing prompt. The question then shows here
   * for either kind of send. Omit and the composer keeps its own.
   */
  modeGate?: InferenceModeGate;
  labels?: BrainComposerLabels;
  className?: string;
}

const NO_PARTICIPANTS: UseMentionAutocompleteOptions['participants'] = [];
const NO_TICKETS: UseTicketAutocompleteOptions['tickets'] = [];
const noop = () => undefined;

export function BrainComposer(props: BrainComposerProps) {
  const {
    value, onChange, onSubmit, running = false, onStop, onQueue, disabled = false, blockedNotice,
    placeholder, ariaLabel, rows = 2, submitOnEnter = true, focusToken, options, account,
    onAccountSettings, attachments, onAddContext, webBrowsing, addMenuItems, mentions, tickets,
    pickersDisabled = false, voice = false, context, above, suggestions, below, modeGate, labels: labelBundle, className,
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
  // The first-run question: a turn sent before the person chose where models run is held
  // behind it and sent the moment they answer (the mode applies first) — THE shared gate,
  // the host's when it owns one.
  const ownGate = useInferenceModeGate(options.inferenceMode);
  const gate = modeGate ?? ownGate;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const submit = () => {
    if (!canSubmit) return;
    gate.request(() => onSubmitRef.current());
  };
  const onQueueRef = useRef(onQueue);
  onQueueRef.current = onQueue;
  const queue = () => {
    const hold = onQueueRef.current;
    if (!canSubmit || !hold) return;
    gate.request(() => hold());
  };

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
        locale={account.locale}
        onUpgrade={account.onUpgrade}
      />
    )
    : undefined;
  // The Spend tab is named by the breakdown's own "Spent" heading, so no host needs a new string.
  const spendTab = account
    ? {
      label: spendLabels(labelBundle?.spend).spendHeading,
      content: (
        <WorkSpendPanel
          request={account.request}
          labels={labelBundle?.spend}
          loadingLabel={workStatusLabels(labelBundle?.status).loading}
          locale={account.locale}
        />
      ),
    }
    : undefined;

  const chips = attachments ? <AttachmentChips items={attachments.items} onRemove={attachments.onRemove} labels={labels} /> : null;
  const showSuggestions = !!suggestions?.items.length && !value.trim() && !running;
  const modeQuestion = gate.asking
    ? <InferenceModeFirstRun labels={promptOptionsLabels(labelBundle?.options)} onChoose={gate.choose} />
    : null;
  const aboveBox = modeQuestion || above || showSuggestions || (attachments && attachments.items.length > 0)
    ? <>{modeQuestion}{above}{showSuggestions && <SuggestionRow items={suggestions!.items} ariaLabel={suggestions!.label} />}{chips}</>
    : undefined;

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
                // Alt+Enter mid-run: hold it for after the run, where the host offers that.
                if (e.altKey && running && onQueue) queue();
                else submit();
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
              spend={spendTab}
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
            {...(onQueue ? { onQueue: queue } : {})}
            voice={voice ? { getValue, setValue: onChange } : undefined}
          />
        )}
      />
      {below}
    </div>
  );
}
