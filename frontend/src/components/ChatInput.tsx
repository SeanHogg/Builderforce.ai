'use client';

import { useRef, useState, useCallback } from 'react';
import Link from 'next/link';

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
  disabled?: boolean;
  /** Send button label/title. */
  submitLabel?: string;
  /** Number of rows for the text area. Default 2. */
  rows?: number;
  /** If false, Enter does not submit (send only via button). Default true. */
  submitOnEnter?: boolean;
  /** Show + attach artifacts button and call onAttach when file selected. */
  onAttach?: (file: File) => void | Promise<void>;
  /** Show brain storm (ideation) icon — link to /brainstorm or callback. */
  showBrainIcon?: boolean;
  /** Show voice (dictate) button. Uses browser Speech Recognition when available. */
  showVoice?: boolean;
  /** Pending attachments to display (e.g. before send). */
  pendingAttachments?: ChatInputAttachment[];
  onRemoveAttachment?: (key: string) => void;
  /** Optional link below the row (e.g. "Manage workforce / claws"). */
  secondaryLink?: { label: string; href: string };
  className?: string;
}

/* Match reference: capsule bar, light grey icons, black send with white arrow */
const CHAT_BAR_BG = 'rgba(248, 247, 245, 0.95)';
const CHAT_BAR_BORDER = 'rgba(0, 0, 0, 0.08)';
const CHAT_ICON_GREY = '#6b7280';
const CHAT_PLUS_GREY = '#4b5563';
const CHAT_SEND_BG = '#1f2937';
const CHAT_SEND_ARROW = '#fff';

const iconButtonStyle = (disabled?: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  minWidth: 40,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: `1px solid ${CHAT_BAR_BORDER}`,
  background: CHAT_BAR_BG,
  color: disabled ? '#9ca3af' : CHAT_ICON_GREY,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const plusButtonStyle = (disabled?: boolean): React.CSSProperties => ({
  ...iconButtonStyle(disabled),
  color: CHAT_PLUS_GREY,
  fontWeight: 300,
  fontSize: '1.25rem',
  lineHeight: 1,
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  color: '#111827',
  fontSize: '0.9375rem',
  borderRadius: 0,
  padding: '10px 12px',
  outline: 'none',
  border: 'none',
  fontFamily: 'var(--font-body)',
  lineHeight: 1.4,
  resize: 'none',
};

const sendButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  minWidth: 40,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: 'none',
  background: disabled ? '#d1d5db' : CHAT_SEND_BG,
  color: CHAT_SEND_ARROW,
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

/** Up arrow (send) */
function SendArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
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
  disabled = false,
  submitLabel = 'Send',
  rows = 2,
  submitOnEnter = false,
  onAttach,
  showBrainIcon = false,
  showVoice = false,
  pendingAttachments = [],
  onRemoveAttachment,
  secondaryLink,
  className,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [recording, setRecording] = useState(false);
  const canSubmit = value.trim().length > 0 && !disabled;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  }, [onChange, value]);

  const stopVoice = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
  }, []);

  return (
    <form onSubmit={handleSubmit} className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {pendingAttachments.length > 0 && onRemoveAttachment && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pendingAttachments.map((a) => (
            <span
              key={a.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 8,
                background: 'var(--surface-coral-soft)',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            >
              📎 {a.name}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.key)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0 }}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          width: '100%',
          padding: '8px 10px 8px 12px',
          borderRadius: 9999,
          border: `1px solid ${CHAT_BAR_BORDER}`,
          background: CHAT_BAR_BG,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        {onAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,.md,.csv,.json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={disabled}
              title="Attach file"
              style={plusButtonStyle(disabled)}
            >
              +
            </button>
          </>
        )}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          style={inputStyle}
        />
        {showBrainIcon && (
          <Link
            href="/brainstorm"
            style={iconButtonStyle(false)}
            title="Brain Storm (ideation)"
          >
            <SpeechBubbleIcon />
          </Link>
        )}
        {showVoice && (
          <button
            type="button"
            onClick={recording ? stopVoice : startVoice}
            disabled={disabled}
            title={recording ? 'Stop dictation' : 'Dictate'}
            style={{ ...iconButtonStyle(disabled), background: recording ? 'rgba(0,0,0,0.06)' : undefined }}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          title={submitLabel}
          style={sendButtonStyle(!canSubmit)}
        >
          <SendArrowIcon />
        </button>
      </div>
      {secondaryLink && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Link href={secondaryLink.href} style={{ fontSize: 12, color: 'var(--coral-bright)', textDecoration: 'none' }}>
            {secondaryLink.label}
          </Link>
        </div>
      )}
    </form>
  );
}
