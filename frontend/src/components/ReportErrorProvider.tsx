'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from './ToastProvider';
import { reportProductError, REPORT_ERROR_EVENT, type ReportErrorPrefill } from '@/lib/reportError';
import { SlideOutPanel } from './SlideOutPanel';
import { Select } from './Select';
import { usePanelTask } from '@/hooks/usePanelTask';
type OpenReporter = (prefill?: ReportErrorPrefill) => void;

/**
 * App-wide "Report an error" host — mirrors {@link ConfirmProvider}: mounts ONE
 * shared reporter panel and opens on the `REPORT_ERROR_EVENT` window event any
 * surface can fire through `requestReportError` (the global error toast's
 * "Report" action, a project page, an error boundary) — one door, above and
 * below this provider alike. Submitting files the error into BuilderForce.ai's fixed
 * product Quality collector, including for visitors without an account.
 */
export function ReportErrorProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('reportError');
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'fatal' | 'error' | 'warning' | 'info'>('error');
  const [url, setUrl] = useState<string | undefined>(undefined);
  const task = usePanelTask();
  const { busy: submitting, clear: clearTask } = task;

  const reportError = useCallback<OpenReporter>((prefill) => {
    setTitle(prefill?.title ?? '');
    setMessage(prefill?.message ?? '');
    setUrl(prefill?.url);
    setLevel('error');
    clearTask();
    setOpen(true);
  }, [clearTask]);

  // Root-level surfaces (the global API-error toast) open the panel via a window
  // event, since they sit above this provider in the tree.
  useEffect(() => {
    const onRequest = (e: Event) => reportError((e as CustomEvent<ReportErrorPrefill>).detail);
    window.addEventListener(REPORT_ERROR_EVENT, onRequest);
    return () => window.removeEventListener(REPORT_ERROR_EVENT, onRequest);
  }, [reportError]);

  const close = useCallback(() => { if (!submitting) setOpen(false); }, [submitting]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || task.busy) return;
    const reported = await task.run(
      async () => {
        await reportProductError(
          { message: message.trim(), title: title.trim() || undefined, url, level },
        );
        return true;
      },
      { failure: t('failed') },
    );
    if (reported === undefined) return;
    toast.success(t('reported'));
    setOpen(false);
  }, [message, title, url, level, task, toast, t]);

  const canSubmit = message.trim().length > 0 && !submitting;

  return (
    <>
      {children}
      <SlideOutPanel open={open} onClose={close} title={t('title')} width="sheet" widthStorageKey="report-error">
        <form onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('intro')}</p>

          <label style={labelStyle}>
            {t('titleLabel')}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              style={fieldStyle}
            />
          </label>

          <label style={labelStyle}>
            {t('messageLabel')}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('messagePlaceholder')}
              required
              rows={5}
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-body)' }}
            />
          </label>

          <label style={labelStyle}>
            {t('levelLabel')}
            <Select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} style={fieldStyle}>
              <option value="fatal">{t('level_fatal')}</option>
              <option value="error">{t('level_error')}</option>
              <option value="warning">{t('level_warning')}</option>
              <option value="info">{t('level_info')}</option>
            </Select>
          </label>

          {task.error && (
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--error-text, var(--error))' }}>{task.error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={close} disabled={submitting} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-small)' }}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '8px 18px', borderRadius: 'var(--radius-lg)', border: 'none', fontWeight: 600, fontSize: 'var(--font-size-small)',
                cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.6,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: 'var(--text-on-accent)',
              }}
            >
              {submitting ? t('submitting') : t('submit')}
            </button>
          </div>
        </form>
      </SlideOutPanel>
    </>
  );
}

/** Imperative opener for the shared Report-error panel. Returns a no-op when the
 *  provider isn't mounted (SSR / isolated render), so callers never need to guard. */

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600,
};
const fieldStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', outline: 'none',
  fontSize: 14, fontWeight: 400,
};
