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
import { memo, useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { PromptPanel } from '../PromptPanel';
import { PromptOptionsMenu } from '../promptOptions/PromptOptionsMenu';
import { promptOptionsLabels, type PromptOptionsLabels } from '../promptOptions/types';
import { InferenceModeFirstRun } from '../inferenceMode/InferenceModeFirstRun';
import { useInferenceModeGate, type InferenceModeGate } from '../inferenceMode/useInferenceModeGate';
import type { UseMentionAutocompleteOptions } from '../mention/MentionAutocomplete';
import type { UseTicketAutocompleteOptions } from '../mention/TicketAutocomplete';
import { WorkStatusPanel } from '../workStatus/WorkStatusPanel';
import { WorkSpendPanel } from '../workStatus/WorkSpendPanel';
import { spendLabels } from '../spend/labels';
import { workStatusLabels } from '../workStatus/labels';
import type { JsonRequest } from '../workStatus/consumptionSnapshot';
import type { UpgradeTarget } from '../workStatus/AccountStatus';
import type { WorkStatusLabels } from '../workStatus/labels';
import type { SpendLabels } from '../spend/labels';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import type { ComposerConnections, ConnectionsLabels } from '../connections/types';
import { ComposerAddMenu, type ComposerAddMenuItem } from './ComposerAddMenu';
import { ComposerTrailingButton } from './ComposerTrailingButton';
import { AttachmentChips, type ComposerAttachment } from './AttachmentChips';
import { composerOptionGroups, type ComposerOptions } from './composerOptions';
import { SuggestionRow, type ComposerSuggestion } from './SuggestionRow';
import { ContextMeter } from './ContextMeter';
import { useDraftIsEmpty, type ContextUsage } from '@seanhogg/builderforce-brain-embedded';
import { ComposerTextBox, type ComposerTextSource } from './ComposerTextBox';
import { composerLabels, type ComposerLabels } from './labels';
import { UNUSED_STORE } from './unusedDraftStore';

export interface BrainComposerLabels {
  composer?: Partial<ComposerLabels>;
  options?: Partial<PromptOptionsLabels>;
  status?: Partial<WorkStatusLabels>;
  spend?: Partial<SpendLabels>;
  connections?: Partial<ConnectionsLabels>;
  mention?: UseMentionAutocompleteOptions['labels'];
  ticket?: UseTicketAutocompleteOptions['labels'];
}

/**
 * The text comes from exactly ONE of:
 *  - `draftStore` (`useComposerDraftStore()`): the box subscribes to the store, so a keystroke re-renders only the
 *    textarea and its typeahead - never this frame, the menus or the host. The choice for a surface that owns more than the box.
 *  - `value` + `onChange`: the host holds the text as React state (every key re-renders the host). Unchanged for
 *    the hosts that have not moved to the store.
 */
export type BrainComposerProps = BrainComposerBaseProps & ComposerTextSource;

export interface BrainComposerBaseProps {
  onSubmit: () => void;
  /** A run is streaming: Send queues behind it, an empty box offers Stop. */
  running?: boolean;
  onStop?: () => void;
  /**
   * The explicit "Queue for after" while a run is going (Alt+Enter), for a host whose
   * Send STEERS the running turn instead of queueing behind it. Omitted ⇒ Alt+Enter sends.
   */
  onQueue?: () => void;
  /** Whether Send while a run streams steers it (true/absent) or holds the message (false) - words the Send button. */
  sendSteers?: boolean;
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
    /** The workspace's connected provider accounts — shown under the Status tab with Test
     *  and Reconnect. Omit on a surface that cannot open a sign-in page. */
    connections?: ComposerConnections;
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
  mentions?: Pick<UseMentionAutocompleteOptions, 'participants' | 'onPick' | 'detail'>;
  tickets?: Pick<UseTicketAutocompleteOptions, 'tickets' | 'onPick'>;
  /** Close the @-mention and #-ticket pickers while the box stays open (e.g. mid-run
   *  with nobody else to address). Always closed while `disabled`. */
  pickersDisabled?: boolean;
  /** Offer dictation in the trailing slot when the runtime can listen. */
  voice?: boolean;
  /** Who answers / who is addressed — rides the tool row after `+` and `/`. */
  context?: ReactNode;
  /** How full the model's context was on the last turn (`contextUsageOf`) — the meter
   *  after `context`. Omitted or null ⇒ no meter. */
  contextUsage?: ContextUsage | null;
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

function BrainComposerInner(props: BrainComposerProps) {
  const {
    draftStore, value, onChange, onSubmit, running = false, onStop, onQueue, sendSteers, disabled = false, blockedNotice,
    placeholder, ariaLabel, rows = 2, submitOnEnter = true, focusToken, options, account,
    onAccountSettings, attachments, onAddContext, webBrowsing, addMenuItems, mentions, tickets,
    pickersDisabled = false, voice = false, context, contextUsage, above, suggestions, below, modeGate, labels: labelBundle, className,
  } = props;
  const labels = composerLabels(labelBundle?.composer);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);

  // "Is the box empty?" is all the frame needs of the text (Send, the suggestion chips, the active border): with a store
  // it subscribes to THAT fact, so it re-renders when the box goes empty or non-empty - not on each key.
  const storeEmpty = useDraftIsEmpty(draftStore ?? UNUSED_STORE);
  const empty = draftStore ? storeEmpty : !(value ?? '').trim();
  // The text right now, for the paths that act on it at call time (submit, dictation): the store's, else the last render's.
  const valueRef = useRef(value ?? '');
  valueRef.current = value ?? '';
  const getValue = useCallback(() => (draftStore ? draftStore.get() : valueRef.current), [draftStore]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const setValue = useCallback((next: string) => {
    if (draftStore) draftStore.set(next);
    else onChangeRef.current?.(next);
  }, [draftStore]);

  useEffect(() => {
    if (focusToken == null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusToken]);

  const canSubmit = !empty && !disabled;
  // The first-run question: a turn sent before the person chose where models run is held
  // behind it and sent the moment they answer (the mode applies first) — THE shared gate,
  // the host's when it owns one.
  const ownGate = useInferenceModeGate(options.inferenceMode);
  const gate = modeGate ?? ownGate;
  // The submit paths read their inputs at call time, so the textarea child keeps ONE identity for them.
  const live = useRef({ onSubmit, onQueue, gate, disabled, getValue });
  live.current = { onSubmit, onQueue, gate, disabled, getValue };
  const submit = useCallback(() => {
    const { onSubmit: send, gate: g, disabled: closed, getValue: read } = live.current;
    if (closed || !read().trim()) return;
    g.request(() => send());
  }, []);
  const queue = useCallback(() => {
    const { onQueue: hold, gate: g, disabled: closed, getValue: read } = live.current;
    if (closed || !hold || !read().trim()) return;
    g.request(() => hold());
  }, []);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const onPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const target = attachmentsRef.current;
    if (!target) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); target.onAdd(files); }
  }, []);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
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
  const connectionsNode = account?.connections
    ? <ConnectionsPanel connections={account.connections} labels={labelBundle?.connections} />
    : null;
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
  const showSuggestions = !!suggestions?.items.length && empty && !running;
  const modeQuestion = gate.asking
    ? <InferenceModeFirstRun labels={promptOptionsLabels(labelBundle?.options)} onChoose={gate.choose} />
    : null;
  const aboveBox = modeQuestion || above || showSuggestions || (attachments && attachments.items.length > 0)
    ? <>{modeQuestion}{above}{showSuggestions && <SuggestionRow items={suggestions!.items} ariaLabel={suggestions!.label} />}{chips}</>
    : undefined;

  const source: ComposerTextSource = draftStore ? { draftStore } : { value: value ?? '', onChange: setValue };
  const resolvedPlaceholder = placeholder ?? labels.placeholder;

  return (
    <div className={['bf-cmp', className].filter(Boolean).join(' ')}>
      {blockedNotice}
      <PromptPanel
        active={focused || !empty}
        dragging={dragging}
        onDragOver={attachments ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
        onDragLeave={attachments ? () => setDragging(false) : undefined}
        onDrop={attachments ? onDrop : undefined}
        status={aboveBox}
        input={(
          <ComposerTextBox
            {...source}
            textareaRef={textareaRef}
            rows={rows}
            placeholder={resolvedPlaceholder}
            ariaLabel={ariaLabel ?? resolvedPlaceholder}
            disabled={disabled}
            submitOnEnter={submitOnEnter}
            running={running}
            canQueue={!!onQueue}
            onSubmit={submit}
            onQueue={queue}
            onPaste={onPaste}
            onFocus={onFocus}
            onBlur={onBlur}
            mentions={mentions}
            tickets={tickets}
            pickersDisabled={pickersDisabled}
            mentionLabels={labelBundle?.mention}
            ticketLabels={labelBundle?.ticket}
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
              status={statusNode && <>{statusNode}{connectionsNode}</>}
              spend={spendTab}
              onAccountSettings={onAccountSettings}
            />
          </>
        )}
        context={context || contextUsage ? <>{context}<ContextMeter usage={contextUsage} labels={labels} locale={account?.locale} /></> : undefined}
        primaryAction={(
          <ComposerTrailingButton
            labels={labels}
            canSubmit={canSubmit}
            running={running}
            disabled={disabled}
            onSend={submit}
            onStop={onStop}
            {...(onQueue ? { onQueue: queue } : {})}
            {...(sendSteers !== undefined ? { sendSteers } : {})}
            voice={voice ? { getValue, setValue } : undefined}
          />
        )}
      />
      {below}
    </div>
  );
}

/**
 * Memoized: with stable props (the host memoizes `options`, `labels`, its handlers) a stream token or an unrelated
 * state change in the host's tree does not re-render the prompt area at all.
 */
export const BrainComposer = memo(BrainComposerInner);
