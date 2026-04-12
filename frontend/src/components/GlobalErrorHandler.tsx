'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  API_ERROR_EVENT,
  type ApiErrorEvent,
} from '@/lib/errors/apiErrorEvent';

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
      ? `\n**Details:**\n\`\`\`json\n${JSON.stringify(ev.details, null, 2)}\n\`\`\``
      : '';
    const ticket = [
      `## Support Ticket — API Error`,
      `**Time:** ${ev.timestamp}`,
      `**URL:** ${ev.method} ${ev.url}`,
      `**Status:** ${ev.status}`,
      ev.code ? `**Code:** ${ev.code}` : null,
      `**Message:** ${ev.message}`,
      ev.requestId ? `**Request ID:** ${ev.requestId}` : null,
      detailsBlock || null,
      `**User Agent:** ${navigator.userAgent}`,
      `**Page:** ${window.location.href}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(ticket);
      setToasts((prev) =>
        prev.map((t) => (t.id === entry.id ? { ...t, copied: true } : t)),
      );
      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === entry.id ? { ...t, copied: false } : t)),
        );
      }, 2000);
    } catch {
      /* clipboard not available */
    }
  }, []);

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
        maxWidth: 420,
        width: '100%',
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
  const { id, event: ev, expanded, copied } = entry;

  return (
    <div
      role="alert"
      style={{
        pointerEvents: 'auto',
        background: 'var(--bg-elevated, #111827)',
        border: '1px solid var(--error-border, rgba(239,68,68,0.5))',
        borderRadius: 'var(--radius-md, 8px)',
        padding: '12px 14px',
        color: 'var(--text-primary, #f0f4ff)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        fontSize: 14,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        animation: 'toast-slide-in 200ms ease-out',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--error, #f87171)', flexShrink: 0 }}>
          <IconAlert />
        </span>
        <span
          style={{
            fontWeight: 600,
            color: 'var(--error-text, #fca5a5)',
            flexShrink: 0,
          }}
        >
          {ev.status}
          {ev.code ? ` ${ev.code}` : ''}
        </span>
        <span
          style={{
            color: 'var(--text-muted, #5a6480)',
            fontSize: 12,
            marginLeft: 'auto',
            flexShrink: 0,
          }}
        >
          {formatTime(ev.timestamp)}
        </span>

        {/* Action buttons */}
        <button
          onClick={() => onToggleExpand(id)}
          title={expanded ? 'Collapse' : 'Expand details'}
          style={iconBtnStyle}
        >
          {expanded ? <IconChevronUp /> : <IconChevronDown />}
        </button>
        <button
          onClick={() => onCopy(entry)}
          title="Copy support ticket"
          style={{
            ...iconBtnStyle,
            color: copied
              ? 'var(--success, #22c55e)'
              : 'var(--text-muted, #5a6480)',
          }}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
        <button
          onClick={() => onDismiss(id)}
          title="Dismiss"
          style={iconBtnStyle}
        >
          <IconX />
        </button>
      </div>

      {/* Message */}
      <div
        style={{
          marginTop: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {ev.message}
      </div>

      {/* Method + URL */}
      <div
        style={{
          marginTop: 2,
          fontSize: 12,
          color: 'var(--text-muted, #5a6480)',
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
            background: 'var(--bg-deep, #050810)',
            border: '1px solid var(--border, rgba(136,146,176,0.15))',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            overflowX: 'auto',
            maxHeight: 192,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-secondary, #8892b0)',
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
  color: 'var(--text-muted, #5a6480)',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
