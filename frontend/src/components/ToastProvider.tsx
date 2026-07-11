'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * ToastProvider — the app-wide, promise-free notification system.
 *
 * Mirrors the {@link ConfirmProvider} convention: ONE provider mounted at the app
 * root (see app/layout.tsx) hands descendants a `useToast()` api so any feature can
 * surface a transient, non-blocking notice (a save succeeded, a learn was rejected,
 * a copy landed) without prop-drilling a banner or reaching for `window.alert`.
 *
 * Toasts are ephemeral status messages — for a decision the user must make, use
 * `useConfirm()`; for a persistent inline error, keep the inline state. Messages are
 * caller-supplied (already localized by the caller); the only built-in string is the
 * dismiss control's aria-label (`common.dismiss`). Themed via CSS variables so it
 * reads natively in light and dark, and it stacks bottom-right on desktop /
 * full-width-bottom on mobile.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  /** Body text — what the user reads. Required. */
  message: string;
  /** Optional bold heading above the message. */
  title?: string;
  /** Visual + a11y severity. Default 'info'. 'warning'/'error' announce as alerts. */
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. Default 5000; pass 0 to keep it until dismissed. */
  durationMs?: number;
}

interface ToastItem {
  id: string;
  message: string;
  title?: string;
  tone: ToastTone;
  durationMs: number;
}

/** Convenience options for the tone helpers (tone is implied by the method). */
type ToneOptions = Omit<ToastOptions, 'message' | 'tone'>;

export interface ToastApi {
  /** Show a toast; returns its id (for manual {@link dismiss}). Bare string = `{ message }`. */
  show: (opts: ToastOptions | string) => string;
  success: (message: string, opts?: ToneOptions) => string;
  error: (message: string, opts?: ToneOptions) => string;
  info: (message: string, opts?: ToneOptions) => string;
  warning: (message: string, opts?: ToneOptions) => string;
  /** Remove a toast early by the id `show` returned. */
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION = 5000;
/** Cap the visible stack; oldest are dropped so a burst can't cover the screen. */
const MAX_TOASTS = 4;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((tst) => tst.id !== id));
  }, []);

  const show = useCallback((raw: ToastOptions | string): string => {
    const o = typeof raw === 'string' ? { message: raw } : raw;
    const id = `t${(seq.current += 1)}`;
    const item: ToastItem = {
      id,
      message: o.message,
      title: o.title,
      tone: o.tone ?? 'info',
      durationMs: o.durationMs ?? DEFAULT_DURATION,
    };
    setToasts((cur) => [...cur, item].slice(-MAX_TOASTS));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, opts) => show({ ...opts, message, tone: 'success' }),
    error: (message, opts) => show({ ...opts, message, tone: 'error' }),
    info: (message, opts) => show({ ...opts, message, tone: 'info' }),
    warning: (message, opts) => show({ ...opts, message, tone: 'warning' }),
    dismiss,
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * The app-wide toast api. Throws if used outside {@link ToastProvider}.
 *
 *   const toast = useToast();
 *   toast.error(t('learnRejected', { reason }));
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

const TONE: Record<ToastTone, { accent: string; role: 'status' | 'alert'; icon: string }> = {
  info: { accent: 'var(--accent, #3987e5)', role: 'status', icon: 'ℹ' },
  success: { accent: 'var(--success, #22c55e)', role: 'status', icon: '✓' },
  warning: { accent: 'var(--warning, #d97706)', role: 'alert', icon: '⚠' },
  error: { accent: 'var(--error, #ef4444)', role: 'alert', icon: '✕' },
};

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const t = useTranslations('common');
  if (toasts.length === 0) return null;
  return (
    <div className="bf-toast-viewport" aria-live="polite">
      <style>{TOAST_CSS}</style>
      {toasts.map((tst) => (
        <ToastCard key={tst.id} toast={tst} dismissLabel={t('dismiss')} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast, dismissLabel, onDismiss,
}: {
  toast: ToastItem; dismissLabel: string; onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const id = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(id);
  }, [toast.id, toast.durationMs, onDismiss]);

  const tone = TONE[toast.tone];
  return (
    <div className="bf-toast" role={tone.role} style={{ borderLeft: `3px solid ${tone.accent}` }}>
      <span className="bf-toast-icon" aria-hidden style={{ color: tone.accent }}>{tone.icon}</span>
      <div className="bf-toast-body">
        {toast.title && <div className="bf-toast-title">{toast.title}</div>}
        <div className="bf-toast-msg">{toast.message}</div>
      </div>
      <button type="button" className="bf-toast-x" onClick={() => onDismiss(toast.id)} aria-label={dismissLabel}>✕</button>
    </div>
  );
}

const TOAST_CSS = `
.bf-toast-viewport {
  position: fixed; z-index: 10000; bottom: 16px; right: 16px;
  display: flex; flex-direction: column; gap: 8px;
  width: min(380px, calc(100vw - 32px)); pointer-events: none;
}
.bf-toast {
  pointer-events: auto; display: flex; align-items: flex-start; gap: 10px;
  background: var(--bg-elevated, var(--surface, #1e2230)); color: var(--text-primary, #e8eaf0);
  border: 1px solid var(--border-subtle, rgba(148,163,184,0.28)); border-radius: 10px;
  padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.22);
}
.bf-toast-icon { flex-shrink: 0; font-size: 0.95rem; line-height: 1.4; font-weight: 700; }
.bf-toast-body { flex: 1; min-width: 0; }
.bf-toast-title { font-size: 0.82rem; font-weight: 700; margin-bottom: 2px; color: var(--text-primary, #e8eaf0); }
.bf-toast-msg { font-size: 0.8rem; line-height: 1.45; color: var(--text-secondary, var(--text-muted, #b6bccb)); word-break: break-word; }
.bf-toast-x {
  flex-shrink: 0; background: transparent; border: none; cursor: pointer; padding: 0 2px;
  color: var(--text-muted, #8b93a7); font-size: 0.8rem; line-height: 1.4; border-radius: 4px;
}
.bf-toast-x:hover { color: var(--text-primary, #e8eaf0); }
@media (max-width: 480px) {
  .bf-toast-viewport { left: 16px; right: 16px; width: auto; bottom: 12px; }
}
@media (prefers-reduced-motion: no-preference) {
  .bf-toast { animation: bf-toast-in 0.18s ease-out; }
  @keyframes bf-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
`;
