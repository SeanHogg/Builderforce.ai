'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useToast } from './ToastProvider';
import { reportProjectError, REPORT_ERROR_EVENT, type ReportErrorPrefill } from '@/lib/reportError';
import { SlideOutPanel } from './SlideOutPanel';
import { Select } from './Select';

type OpenReporter = (prefill?: ReportErrorPrefill) => void;

const ReportErrorContext = createContext<OpenReporter | null>(null);

/**
 * App-wide "Report an error" host — mirrors {@link ConfirmProvider}: mounts ONE
 * shared reporter panel and exposes an imperative `useReportError()` opener any
 * surface can call (the global error toast's "Report" action, a project page, an
 * error boundary). Submitting files the error into the chosen project's Quality
 * feed via `POST /api/quality/report`.
 */
export function ReportErrorProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('reportError');
  const toast = useToast();
  const scope = useOptionalProjectScope();
  const projects = scope?.projects ?? [];

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'fatal' | 'error' | 'warning' | 'info'>('error');
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reportError = useCallback<OpenReporter>((prefill) => {
    setTitle(prefill?.title ?? '');
    setMessage(prefill?.message ?? '');
    setUrl(prefill?.url);
    setLevel('error');
    setError(null);
    // Default to the prefill's project, else the currently-scoped project, else
    // the only project (when there is just one).
    const preferred = prefill?.projectId ?? scope?.currentProjectId ?? (projects.length === 1 ? projects[0].id : null);
    setProjectId(preferred);
    setOpen(true);
  }, [scope?.currentProjectId, projects]);

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
    if (projectId == null || !message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await reportProjectError({ projectId, message: message.trim(), title: title.trim() || undefined, url, level });
      toast.success(t('reported'));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, message, title, url, level, submitting, toast, t]);

  const value = useMemo(() => reportError, [reportError]);

  const canSubmit = projectId != null && message.trim().length > 0 && !submitting;

  return (
    <ReportErrorContext.Provider value={value}>
      {children}
      <SlideOutPanel open={open} onClose={close} title={t('title')} width="min(460px, 96vw)">
        <form onSubmit={submit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('intro')}</p>

          <label style={labelStyle}>
            {t('projectLabel')}
            <Select
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              required
              style={fieldStyle}
            >
              <option value="">{t('projectPlaceholder')}</option>
              {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </label>

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

          {projects.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{t('noProjects')}</p>
          )}
          {error && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--error-text, #f87171)' }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={close} disabled={submitting} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '8px 18px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 14,
                cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.6,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark, #d94f4a))', color: '#fff',
              }}
            >
              {submitting ? t('submitting') : t('submit')}
            </button>
          </div>
        </form>
      </SlideOutPanel>
    </ReportErrorContext.Provider>
  );
}

/** Imperative opener for the shared Report-error panel. Returns a no-op when the
 *  provider isn't mounted (SSR / isolated render), so callers never need to guard. */
export function useReportError(): OpenReporter {
  return useContext(ReportErrorContext) ?? (() => { /* provider not mounted */ });
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600,
};
const fieldStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', outline: 'none',
  fontSize: 14, fontWeight: 400,
};
