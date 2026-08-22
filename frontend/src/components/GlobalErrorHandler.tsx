'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  API_ERROR_EVENT,
  type ApiErrorEvent,
} from '@/lib/errors/apiErrorEvent';
import { requestReportError } from '@/lib/reportError';
import { useApiErrorText } from '@/lib/errors/useApiErrorText';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { useFormat } from "@/i18n/useFormat";

/* ------------------------------------------------------------------ */
/*  Inline SVG icons (no lucide-react dependency)                     */
/* ------------------------------------------------------------------ */

const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconCopy = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconAlert = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconFlag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface ToastEntry {
  id: string;
  event: ApiErrorEvent;
  expanded: boolean;
  copied: boolean;
}

const MAX_TOASTS = 5;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function GlobalErrorHandler() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const t = useTranslations('globalError');
  // The same naming the toast uses, so a copied ticket and the toast that
  // produced it can never describe the failure differently.
  const text = useApiErrorText();

  useEffect(() => {
    function onApiError(e: Event) {
      const detail = (e as CustomEvent<ApiErrorEvent>).detail;
      setToasts((prev) => {
        const next: ToastEntry[] = [
          {
            id: `${detail.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            event: detail,
            expanded: false,
            copied: false,
          },
          ...prev,
        ];
        return next.slice(0, MAX_TOASTS);
      });
    }

    window.addEventListener(API_ERROR_EVENT, onApiError);
    return () => window.removeEventListener(API_ERROR_EVENT, onApiError);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t)),
    );
  }, []);

  const copyTicket = useCallback(async (entry: ToastEntry) => {
    const { event: ev } = entry;
    const detailsBlock = ev.details
      ? `\n**${t('ticket.details')}:**\n\`\`\`json\n${JSON.stringify(ev.details, null, 2)}\n\`\`\``
      : '';
    const ticket = [
      `## ${t('ticket.heading')}`,
      `**${t('ticket.time')}:** ${ev.timestamp}`,
      `**${t('ticket.url')}:** ${ev.method} ${ev.url}`,
      `**${t('ticket.status')}:** ${text.title(ev)}`,
      ev.code ? `**${t('ticket.code')}:** ${ev.code}` : null,
      `**${t('ticket.message')}:** ${text.message(ev)}`,
      ev.requestId ? `**${t('ticket.requestId')}:** ${ev.requestId}` : null,
      detailsBlock || null,
      `**${t('ticket.userAgent')}:** ${navigator.userAgent}`,
      `**${t('ticket.page')}:** ${window.location.href}`,
    ]
      .filter(Boolean)
      .join('\n');

    // The plain shared write, not the hook: `copied` is per-toast state living inside the
    // toasts array, which the hook's single state could not represent. A refused
    // clipboard resolves false and leaves the toast unflagged, as the old catch did.
    if (!await copyTextToClipboard(ticket)) return;
    setToasts((prev) =>
      prev.map((toast) => (toast.id === entry.id ? { ...toast, copied: true } : toast)),
    );
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((toast) => (toast.id === entry.id ? { ...toast, copied: false } : toast)),
      );
    }, 2000);
  }, [t, text]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: 'min(520px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((entry) => (
        <Toast
          key={entry.id}
          entry={entry}
          onDismiss={dismiss}
          onToggleExpand={toggleExpand}
          onCopy={copyTicket}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual toast                                                   */
/* ------------------------------------------------------------------ */

function Toast({
  entry,
  onDismiss,
  onToggleExpand,
  onCopy,
}: {
  entry: ToastEntry;
  onDismiss: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onCopy: (entry: ToastEntry) => void;
}) {
  const fmt = useFormat();
  const t = useTranslations('globalError');
  const text = useApiErrorText();
  const { id, event: ev, expanded, copied } = entry;

  return (
    <div
      role="alert"
      style={{
        pointerEvents: 'auto',
        background: 'var(--bg-elevated, var(--bg-elevated))',
        border: '1px solid var(--error-border, rgba(239,68,68,0.5))',
        borderRadius: 'var(--radius-md, 8px)',
        padding: '12px 14px',
        color: 'var(--text-primary, var(--text-primary))',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        fontSize: 'var(--font-size-small)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        animation: 'toast-slide-in 200ms ease-out',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ color: 'var(--error, var(--error))', flexShrink: 0 }}>
          <IconAlert />
        </span>
        <span
          style={{
            fontWeight: 600,
            color: 'var(--error-text)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {text.title(ev)}
        </span>
        <span
          style={{
            color: 'var(--text-muted, var(--text-muted))',
            fontSize: 'var(--font-size-small)',
            marginLeft: 'auto',
            flexShrink: 0,
          }}
        >
          {fmt.time(ev.timestamp)}
        </span>

        {/* Action buttons */}
        <button
          onClick={() => onToggleExpand(id)}
          title={expanded ? t('collapse') : t('expandDetails')}
          style={iconBtnStyle}
        >
          {expanded ? <IconChevronUp /> : <IconChevronDown />}
        </button>
        {/* Add user context to this error in BuilderForce.ai's product Quality feed. */}
        <button
          onClick={() => requestReportError({
            title: text.title(ev),
            message: text.message(ev),
            url: ev.url,
          })}
          title={t('report')}
          aria-label={t('report')}
          style={iconBtnStyle}
        >
          <IconFlag />
        </button>
        <button
          onClick={() => onCopy(entry)}
          title={t('copyTicket')}
          style={{
            ...iconBtnStyle,
            color: copied
              ? 'var(--success, var(--success))'
              : 'var(--text-muted, var(--text-muted))',
          }}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
        <button
          onClick={() => onDismiss(id)}
          title={t('dismiss')}
          style={iconBtnStyle}
        >
          <IconX />
        </button>
      </div>

      {/* Message. Clamped rather than truncated to one line: a transport failure
          explains what actually happened in a sentence, and a single ellipsised
          line reduced it to "The API returned no response at…". */}
      <div
        style={{
          marginTop: 6,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
          wordBreak: 'break-word',
        }}
      >
        {text.message(ev)}
      </div>

      {/* Method + URL */}
      <div
        style={{
          marginTop: 2,
          fontSize: 'var(--font-size-small)',
          color: 'var(--text-muted, var(--text-muted))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {ev.method} {ev.url}
      </div>

      {/* Expanded details */}
      {expanded && (
        <pre
          style={{
            marginTop: 8,
            padding: 10,
            background: 'var(--bg-deep, var(--bg-deep))',
            border: '1px solid var(--border, rgba(136,146,176,0.15))',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: 'var(--font-size-small)',
            fontFamily: 'var(--font-mono, monospace)',
            overflowX: 'auto',
            maxHeight: 192,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-secondary, var(--text-secondary))',
          }}
        >
          {JSON.stringify(
            {
              status: ev.status,
              code: ev.code,
              message: ev.message,
              url: ev.url,
              method: ev.method,
              requestId: ev.requestId,
              details: ev.details,
              timestamp: ev.timestamp,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--text-muted, var(--text-muted))',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
};

