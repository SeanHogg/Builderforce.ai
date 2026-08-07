'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PromptPanel, PromptOptionsMenu, useMentionAutocomplete, type ChatModelOptions, type ChatModelSelection, type PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';
import { effortProfile, type DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import { CHAT_MODES, CHAT_MODE_ICON, type BrainEffort, type ChatMode } from '@/lib/brain';
import { PlanBadge } from '@/components/PlanBadge';
export type { ChatModelOptions, ChatModelSelection } from '@seanhogg/builderforce-brain-ui';

/** Browser Web Speech API (not in all TS libs). */
type SpeechRecognitionInstance = {
  start(): void;
  stop(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; [0]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
};

export interface ChatInputAttachment {
  key: string;
  name: string;
  type: string;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Accessible name when it should differ from the visible placeholder. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Send button label/title. */
  submitLabel?: string;
  /**
   * When true, a run is in flight: the Send button is replaced by a Stop button
   * that calls {@link onStop}. Requires `onStop` to render (otherwise the Send
   * button shows as before). Lets the user interrupt a streaming reply.
   */
  running?: boolean;
  /** Interrupt the in-flight run (shown as a Stop button while `running`). */
  onStop?: () => void;
  /** Stop button label/title. */
  stopLabel?: string;
  /** Number of rows for the text area. Default 2. */
  rows?: number;
  /** If false, Enter does not submit (send only via button). Default true. */
  submitOnEnter?: boolean;
  /** Show + attach artifacts button and call onAttach when file selected. */
  onAttach?: (file: File) => void | Promise<void>;
  /**
   * When set, the `+` button becomes a Claude-style menu with an "Add context"
   * item that invokes this (e.g. attach a project/page reference). Needs `onAttach`
   * for the menu to render (Upload lives in the same menu).
   */
  onAddContext?: () => void;
  /** When set, the `+` menu shows a "Browse the web" toggle bound to this state. */
  webBrowsing?: boolean;
  onWebBrowsingChange?: (on: boolean) => void;
  /** When set, a `/` options menu exposes an Effort selector bound to this state. */
  effort?: BrainEffort;
  onEffortChange?: (effort: BrainEffort) => void;
  /** When set, the `/` options menu shows a "Thinking" toggle bound to this state. */
  thinking?: boolean;
  onThinkingChange?: (on: boolean) => void;
  /** When set, the `/` options menu shows an "Account settings" link to this href. */
  accountSettingsHref?: string;
  /** Model routing for the next turn, shown and changed in the `/` menu. A named
   *  model is sent as a strict pin. */
  modelSelection?: ChatModelSelection;
  modelOptions?: ChatModelOptions;
  onModelSelectionChange?: (selection: ChatModelSelection) => void;
  /** The model the gateway will actually use while the selection is `auto`, when
   *  the host knows it — so the menu names what is running, not just "Auto". */
  effectiveModel?: string;
  /** False ⇒ the tenant may not pin a model (no paid plan, no connected provider):
   *  the `/` menu says why instead of offering a list the gateway would reject. */
  canChooseModel?: boolean;
  /**
   * Conversation mode for this turn — Chat (answer it) or Work (open it, staff it,
   * dispatch it). Shown and changed in the `/` menu, and named on its trigger: this
   * is the setting that decides whether a turn can leave real work behind, so it is
   * readable without opening anything but does not cost the action row a control.
   */
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  /** Persistent memory for this conversation, shown and changed in the `/` menu. */
  memoryEnabled?: boolean;
  onMemoryChange?: (on: boolean) => void;
  /** Why memory is unusable right now — the `/` menu states it rather than offering
   *  a toggle that would do nothing. */
  memoryUnavailableReason?: string;
  /**
   * Consolidate / fork THIS chat, shown in the `/` menu (never as pills in the
   * action row — they are inert for most of a chat's life and would crowd out Send
   * on a narrow panel). Needs both handlers to render.
   */
  canConsolidate?: boolean;
  consolidating?: boolean;
  forking?: boolean;
  onConsolidate?: () => void;
  onFork?: () => void;
  /** When set, an "Auto mode" pill toggles this (auto-approve tool actions). */
  autoMode?: boolean;
  onAutoModeChange?: (on: boolean) => void;
  /** Show brain storm (ideation) icon — link to /brainstorm or callback. */
  showBrainIcon?: boolean;
  /** Show voice (dictate) button. Uses browser Speech Recognition when available. */
  showVoice?: boolean;
  /** Pending attachments to display (e.g. before send). */
  pendingAttachments?: ChatInputAttachment[];
  onRemoveAttachment?: (key: string) => void;
  /** Optional content rendered right-aligned below the input row (e.g. agent-connection status). */
  secondaryContent?: React.ReactNode;
  /**
   * Invited chat participants (agents + humans). When non-empty the composer gets
   * an @-mention typeahead: typing `@` opens a picker; choosing one calls
   * {@link onMention} (wire to the recipient choice) and clears the `@query`.
   */
  mentionables?: DirectedRecipient[];
  /** Called when a participant is picked from the @-mention typeahead. */
  onMention?: (recipient: DirectedRecipient) => void;
  /** Context selectors rendered first in the canonical action row. */
  contextControls?: React.ReactNode;
  /** Host-specific modes rendered after the shared mode/model controls. */
  modeControls?: React.ReactNode;
  className?: string;
  /**
   * Change this to any new value to focus the composer and put the caret at the
   * end of the text. Used when something else seeds the composer (e.g. picking a
   * capability), so the seeded line reads as a sentence to finish rather than a
   * finished message to send.
   */
  focusToken?: number | string;
}

/* Theme-aware: uses --chat-input-* from globals.css (light and dark).
   Sizing comes from the shared --chat-ctl-* metrics so every control in the
   composer (and the toolbars around it) stays one size, and coarse pointers get
   the touch-friendly variant without a second set of numbers here. */
const iconButtonStyle = (disabled?: boolean): React.CSSProperties => ({
  width: 'var(--chat-ctl-size, 32px)',
  height: 'var(--chat-ctl-size, 32px)',
  minWidth: 'var(--chat-ctl-size, 32px)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: '1px solid var(--chat-input-border)',
  background: 'var(--chat-input-bg)',
  color: disabled ? 'var(--chat-input-disabled-icon)' : 'var(--chat-input-icon)',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  color: 'var(--chat-input-text)',
  fontSize: '0.9375rem',
  borderRadius: 0,
  padding: '6px 4px',
  outline: 'none',
  border: 'none',
  fontFamily: 'var(--font-body)',
  lineHeight: 1.4,
  resize: 'none',
};

const sendButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 'var(--chat-ctl-size, 32px)',
  height: 'var(--chat-ctl-size, 32px)',
  minWidth: 'var(--chat-ctl-size, 32px)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: 'none',
  background: disabled ? 'var(--chat-input-disabled-send-bg)' : 'var(--chat-input-send-bg)',
  color: 'var(--chat-input-send-icon)',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

/** Speech bubble outline (ideation / brain storm) */
function SpeechBubbleIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Microphone outline */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

/** Filled square (stop / interrupt) */
function StopSquareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Up arrow (send) */
function SendArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

/** Lightning bolt (auto mode) */
function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

const menuPopStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  zIndex: 50,
  minWidth: 224,
  padding: 5,
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
};

/**
 * A popover menu anchored to a composer icon button. Opens upward (the composer
 * sits at the bottom of the panel). Closes on outside click or Escape. Shared by
 * the `+` (add) and `/` (options) affordances — DRY.
 */
function ComposerMenu({ trigger, title, disabled, children }: {
  trigger: React.ReactNode;
  title: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ ...iconButtonStyle(disabled), background: open ? 'var(--surface-interactive, var(--bg-elevated))' : iconButtonStyle(disabled).background }}
      >
        {trigger}
      </button>
      {open && <div role="menu" style={menuPopStyle}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** One row in a {@link ComposerMenu}: icon + label, optional hint/active check. */
function MenuRow({ icon, label, hint, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '8px 9px',
    border: 'none',
    borderRadius: 8,
    background: hover ? 'var(--surface-interactive, var(--bg-base))' : 'transparent',
    color: 'var(--text-primary)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    textDecoration: 'none',
  };
  const body = (
    <>
      <span aria-hidden style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {hint != null && <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{hint}</span>}
      {active && <span aria-hidden style={{ color: 'var(--coral-bright, #f4726e)', width: 12 }}>✓</span>}
    </>
  );
  const shared = { style, role: 'menuitem' as const, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  return <button type="button" onClick={onClick} {...shared}>{body}</button>;
}

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
  stopLabel = 'Stop',
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
  canChooseModel = true,
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
  pendingAttachments = [],
  onRemoveAttachment,
  secondaryContent,
  mentionables,
  onMention,
  contextControls,
  modeControls,
  className,
  focusToken,
}: ChatInputProps) {
  const t = useTranslations('chatInput');
  // The two mode names are the conversation's vocabulary, not the composer's — they
  // are the SAME words the Brain empty state uses, from the same catalog namespace.
  const tModes = useTranslations('brain.modes');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs
  valueRef.current = value;
  const [recording, setRecording] = useState(false);
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
  const router = useRouter();
  const canSubmit = value.trim().length > 0 && !disabled;
  // "Activated" once the user is typing in / focused on the composer — the whole
  // box lights up in accent (blue), the same treatment as the VS Code composer so
  // the experience matches across every modality.
  const active = focused || value.trim().length > 0;

  // The `/` menu's copy. Localized here (next-intl) and handed to the SHARED
  // control, so the web and the editor render the same menu from their own bundles.
  // The per-row funding lines that interpolate a value (the BYO vendor, the metered
  // price) are formatted by the options builder instead — see useChatModelOptions.
  const optionLabels = useMemo<Partial<PromptOptionsLabels>>(() => ({
    options: t('options'),
    mode: tModes('pickerAria'),
    memory: t('memory'),
    conversation: t('conversation'),
    consolidate: t('consolidate'),
    consolidating: t('consolidating'),
    consolidateHint: t('consolidateHint'),
    fork: t('fork'),
    forking: t('forking'),
    forkHint: t('forkHint'),
    sessionUnavailable: t('sessionUnavailable'),
    effort: t('effort'),
    effortQuick: t('effort_quick'),
    effortBalanced: t('effort_balanced'),
    effortThorough: t('effort_thorough'),
    thinking: t('thinking'),
    on: t('on'),
    off: t('off'),
    model: t('model'),
    modelInUse: t('modelInUse'),
    searchModels: t('searchModels'),
    filterModels: t('filterModels'),
    chooseModel: t('chooseModel'),
    noModels: t('noModels'),
    all: t('all'),
    categoryAuto: t('categoryAuto'),
    categoryByo: t('categoryByo'),
    categoryFree: t('categoryFree'),
    categoryPlan: t('categoryPlan'),
    categoryPaid: t('categoryPaid'),
    categoryConfigured: t('categoryConfigured'),
    autoLabel: t('categoryAuto'),
    autoDetail: t('autoDetail'),
    poolLabel: t('poolLabel'),
    poolDetail: t('poolDetail'),
    freeDetail: t('freeDetail'),
    planDetail: t('planDetail'),
    paidDetail: t('paidDetail'),
    configuredDetail: t('configuredDetail'),
    evermindLabel: t('evermindLabel'),
    evermindDetail: t('evermindDetail'),
    modelLocked: t('modelLocked'),
    accountSettings: t('accountSettings'),
  }), [t]);

  // Chat | Work, built from the SHARED mode list so a mode cannot exist in the
  // vocabulary and be missing from the control that arms it.
  const modeChoices = useMemo(
    () => CHAT_MODES.map((mode) => ({ value: mode, label: tModes(`${mode}.label`), hint: tModes(`${mode}.hint`), icon: CHAT_MODE_ICON[mode] })),
    [tModes],
  );
  const describeMemory = useCallback((on: boolean) => t(on ? 'memoryOnHint' : 'memoryOffHint'), [t]);

  // What each control really costs, read from the SHARED effort table so the copy
  // can never promise a budget the request does not send.
  const describeEffort = useCallback((level: BrainEffort) => {
    const { maxTokens, thinkingBudgetTokens } = effortProfile(level);
    const base = t(`effortDesc_${level}`, { answer: maxTokens.toLocaleString() });
    return thinking ? `${base} ${t('effortDescThinking', { thinking: thinkingBudgetTokens.toLocaleString() })}` : base;
  }, [t, thinking]);
  const describeThinking = useCallback(
    (on: boolean) => (on
      ? t('thinkingOnDesc', { budget: effortProfile(effort ?? 'balanced').thinkingBudgetTokens.toLocaleString() })
      : t('thinkingOffDesc')),
    [t, effort],
  );

  // The textarea always takes its own full-width row on top (so typed text is
  // never crushed into a sliver in a narrow side-panel), and the control buttons
  // sit on a second row below — matching the VS Code composer across modalities.
  // The trailing group (plan · host modes · brain / voice / send) is pushed right
  // by marginLeft:auto on the plan-chip wrapper, so Send always lands bottom-right,
  // Claude-style. The wrapper renders even when the chip self-gates to nothing,
  // which is exactly why it — and not a conditional icon — owns the anchor.
  const trailingShift: React.CSSProperties = { marginLeft: 'auto' };

  // @-mention typeahead — active only when the host supplies participants. Picking
  // one routes the next turn (via onMention) and strips the "@query" from the text.
  // Works in every modality: the participant set comes from the chat, not the persona.
  const noopMention = useCallback(() => {}, []);
  const mention = useMentionAutocomplete({
    textareaRef,
    value,
    setValue: onChange,
    participants: mentionables ?? [],
    onPick: onMention ?? noopMention,
    disabled,
    labels: { title: t('mentionTitle'), agent: t('mentionAgent'), human: t('mentionHuman') },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The @-mention picker gets first refusal on nav/select/escape keys.
    if (mention.onKeyDown(e)) return;
    if (submitOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
    // When submitOnEnter is false, Enter adds a new line (default textarea behavior); only Up arrow submits
  };

  const handleAttachClick = () => {
    if (disabled || !onAttach) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onAttach) void onAttach(file);
      e.target.value = '';
    },
    [onAttach]
  );

  // Paste an image straight from the clipboard (e.g. a screenshot) — same path
  // as the + button, so it flows through onAttach → vision content part.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onAttach) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void onAttach(file);
          }
        }
      }
    },
    [onAttach]
  );

  // Drag-and-drop image files onto the input.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onAttach) return;
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) void onAttach(file);
      }
    },
    [onAttach]
  );

  const startVoice = useCallback(() => {
    const Win = typeof window !== 'undefined' ? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance; SpeechRecognition?: new () => SpeechRecognitionInstance }) : null;
    const Recognition = Win?.SpeechRecognition ?? Win?.webkitSpeechRecognition;
    if (!Recognition) return;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setRecording(false);
      return;
    }
    const r = new Recognition();
    recognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let lastFinal = '';
    r.onresult = (event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; [0]: { transcript: string } } } }) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) lastFinal += transcript;
      }
      if (lastFinal) {
        const current = valueRef.current;
        onChange(current + (current ? ' ' : '') + lastFinal);
        lastFinal = '';
      }
    };
    r.onend = () => {
      recognitionRef.current = null;
      setRecording(false);
    };
    r.start();
    setRecording(true);
  }, [onChange]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
  }, []);

  return (
    <form onSubmit={handleSubmit} className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--chat-ctl-gap, 6px)' }}>
      <PromptPanel
        active={active}
        onDrop={onAttach ? handleDrop : undefined}
        onDragOver={onAttach ? (e) => e.preventDefault() : undefined}
        overlay={mention.popup}
        status={pendingAttachments.length > 0 && onRemoveAttachment ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pendingAttachments.map((a) => (
              <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, background: 'var(--surface-coral-soft)', fontSize: 12, color: 'var(--text-primary)' }}>
                📎 {a.name}
                <button type="button" onClick={() => onRemoveAttachment(a.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0 }} aria-label={t('removeAttachment')}>×</button>
              </span>
            ))}
          </div>
        ) : undefined}
        input={(
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={mention.onSelect}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={onAttach ? handlePaste : undefined}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            disabled={disabled}
            rows={rows}
            style={{ ...inputStyle, flexBasis: '100%', minWidth: '100%' }}
          />
        )}
        actions={(
          <>
            {onAttach && (
              <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,.md,.csv,.tsv,.json,.docx,.rtf,.xlsx,.pptx"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {/* `+` becomes a Claude-style menu: Upload, Add context, Browse the web. */}
            <ComposerMenu title={t('add')} disabled={disabled} trigger={<span style={{ fontSize: '1.25rem', fontWeight: 300, lineHeight: 1 }}>+</span>}>
              {(close) => (
                <>
                  <MenuRow icon="💻" label={t('upload')} onClick={() => { close(); handleAttachClick(); }} />
                  {onAddContext && <MenuRow icon="◧" label={t('addContext')} onClick={() => { close(); onAddContext(); }} />}
                  {onWebBrowsingChange && (
                    <MenuRow
                      icon="🌐"
                      label={t('browseWeb')}
                      hint={webBrowsing ? t('on') : t('off')}
                      active={!!webBrowsing}
                      onClick={() => onWebBrowsingChange(!webBrowsing)}
                    />
                  )}
                </>
              )}
            </ComposerMenu>
              </>
            )}
            {/* `/` : effort, thinking, WHICH MODEL IS RUNNING and how to change it,
                and account settings — the one shared control, so this composer can
                never grow a second "which model" chip beside it again. */}
            <PromptOptionsMenu
              labels={optionLabels}
              disabled={disabled}
              mode={chatMode && onChatModeChange ? { value: chatMode, onChange: (next) => onChatModeChange(next as ChatMode), choices: modeChoices } : undefined}
              memory={onMemoryChange ? { enabled: !!memoryEnabled, onChange: onMemoryChange, unavailableReason: memoryUnavailableReason, describe: describeMemory } : undefined}
              session={onConsolidate && onFork ? { canConsolidate, consolidating, forking, onConsolidate, onFork } : undefined}
              effort={effort}
              onEffortChange={onEffortChange}
              describeEffort={describeEffort}
              thinking={thinking}
              onThinkingChange={onThinkingChange}
              describeThinking={describeThinking}
              model={onModelSelectionChange && modelOptions && modelSelection
                ? { selection: modelSelection, options: modelOptions, onChange: onModelSelectionChange, effective: effectiveModel, canChoose: canChooseModel }
                : undefined}
              onAccountSettings={accountSettingsHref ? () => router.push(accountSettingsHref) : undefined}
            />
            {contextControls}
            {onAutoModeChange && (
          <button
            type="button"
            className="bf-chat-auto-mode"
            onClick={() => onAutoModeChange(!autoMode)}
            disabled={disabled}
            title={t('autoModeHint')}
            aria-pressed={!!autoMode}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
              height: 'var(--chat-ctl-size, 32px)',
              padding: '0 10px',
              borderRadius: 9999,
              fontSize: 12,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${autoMode ? 'var(--coral-bright, #f4726e)' : 'var(--chat-input-border)'}`,
              background: autoMode ? 'var(--surface-coral-soft, rgba(244,114,110,0.12))' : 'transparent',
              color: autoMode ? 'var(--coral-bright, #f4726e)' : 'var(--text-muted)',
            }}
          >
            <BoltIcon />
            <span>{t('autoMode')}</span>
          </button>
            )}
            {/* Which plan is funding this chat (and, when metered, what allowance is
                left) — the same chip, in the same place, as the VS Code composer.
                Self-gating: it renders nothing without a tenant session, so the
                wrapper carries the right-alignment anchor instead of the chip. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, ...trailingShift }}>
              <PlanBadge />
            </span>
            {modeControls}
            {showBrainIcon && (
          <Link
            href="/brainstorm"
            style={iconButtonStyle(false)}
            title={t('brainstorm')}
          >
            <SpeechBubbleIcon />
          </Link>
            )}
            {showVoice && (
          <button
            type="button"
            onClick={recording ? stopVoice : startVoice}
            disabled={disabled}
            title={recording ? t('stopDictation') : t('dictate')}
            style={{ ...iconButtonStyle(disabled), background: recording ? 'var(--surface-interactive)' : undefined }}
          >
            <MicIcon />
          </button>
            )}
            {running && onStop && !canSubmit ? (
          // Streaming with an empty composer → the button interrupts the run.
          // When the composer HAS submittable text (e.g. the queue-while-thinking
          // path where the host keeps the input editable), the Send button below
          // renders instead so the typed turn can be queued.
          <button
            type="button"
            onClick={onStop}
            title={stopLabel}
            aria-label={stopLabel}
            style={sendButtonStyle(false)}
          >
            <StopSquareIcon />
          </button>
            ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            title={submitLabel}
            style={sendButtonStyle(!canSubmit)}
          >
            <SendArrowIcon />
          </button>
            )}
          </>
        )}
      />
      {secondaryContent && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {secondaryContent}
        </div>
      )}
    </form>
  );
}
