import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { customerFeedbackApi, type CustomerFeedbackRow } from '@/lib/builderforceApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';

type Status = CustomerFeedbackRow['status'];
const STATUSES: Status[] = ['new', 'triaged', 'dismissed'];

/**
 * The Voice-of-Customer inbox (spec 05 §4.2): what the site's feedback widgets
 * collected, triaged here. Distinct from the in-product feedback queue — those
 * are people using Builderforce; these are the CUSTOMERS of what someone built
 * on it. Self-contained: it loads, filters and triages its own rows.
 */
export function CustomerFeedbackInbox() {
  const errorMessage = useErrorMessage();
  const t = useTranslations('feedback.voc');
  const fmt = useFormat();
  const [status, setStatus] = useState<Status>('new');
  const [rows, setRows] = useState<CustomerFeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    customerFeedbackApi.list(status)
      .then((r) => { setRows(r.feedback ?? []); setError(null); })
      .catch((e: unknown) => setError(errorMessage(e) ?? t('error')));
  }, [status, t, errorMessage]);
  useEffect(() => { load(); }, [load]);

  const triage = async (row: CustomerFeedbackRow, next: Status) => {
    setBusyId(row.id);
    try {
      await customerFeedbackApi.triage(row.id, { status: next });
      load();
    } catch (e: unknown) {
      setError(errorMessage(e) ?? t('error'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-labelledby="voc-inbox-heading"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16, marginTop: 16 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 id="voc-inbox-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{t('title')}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('description')}</p>
        </div>
        <div role="group" aria-label={t('filterLabel')} style={{ display: 'flex', gap: 4 }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === status}
              onClick={() => setStatus(s)}
              style={{
                padding: '6px 10px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                background: s === status ? 'var(--coral-bright)' : 'var(--bg-elevated)',
                color: s === status ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--error-text, var(--error))' }}>{error}</p>}
      {!error && rows === null && <p style={{ margin: '10px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</p>}
      {rows && rows.length === 0 && <p style={{ margin: '10px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('empty')}</p>}

      {rows && rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <li key={row.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 12px', display: 'grid', gap: 6 }}>
              <p style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{row.text}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                <span>{fmt.dateTime(row.createdAt)}</span>
                {row.sentiment && <span>· {t('sentiment', { value: row.sentiment })}</span>}
                {row.contact && <span>· {row.contact}</span>}
                <span style={{ flex: 1 }} />
                {row.status !== 'triaged' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === row.id} onClick={() => triage(row, 'triaged')}>{t('markTriaged')}</button>
                )}
                {row.status !== 'dismissed' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === row.id} onClick={() => triage(row, 'dismissed')}>{t('dismiss')}</button>
                )}
                {row.status !== 'new' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === row.id} onClick={() => triage(row, 'new')}>{t('reopen')}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default CustomerFeedbackInbox;
