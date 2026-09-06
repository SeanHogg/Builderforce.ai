import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { consentApi, DOCUMENT_KINDS, type ConsentAcceptance, type DocumentKind } from '@/lib/consentApi';
import { faultMessage } from '@/lib/apiClient';

/**
 * The person's own standing against every published legal document kind: the
 * version they accepted and when, or that it is still outstanding.
 *
 * Self-contained — it loads its own two reads and decides its own states — so
 * it mounts under /security beside the other personal panels with no props.
 */
export function LegalAgreementsPanel() {
  const t = useTranslations('security.agreements');
  const fmt = useFormat();
  const [acceptances, setAcceptances] = useState<ConsentAcceptance[] | null>(null);
  const [outstanding, setOutstanding] = useState<Set<DocumentKind> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([consentApi.mine(), consentApi.outstanding(DOCUMENT_KINDS)])
      .then(([mine, owed]) => {
        if (!live) return;
        setAcceptances(mine);
        setOutstanding(new Set(owed.outstanding));
      })
      .catch((e: unknown) => { if (live) setError(faultMessage(e) ?? t('error')); });
    return () => { live = false; };
  }, [t]);

  const latestByKind = new Map<string, ConsentAcceptance>();
  for (const row of acceptances ?? []) {
    if (!latestByKind.has(row.documentKind)) latestByKind.set(row.documentKind, row);
  }

  return (
    <section
      aria-labelledby="legal-agreements-heading"
      style={{
        background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16,
      }}
    >
      <h3 id="legal-agreements-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{t('title')}</h3>
      <p style={{ margin: '4px 0 12px', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('description')}</p>

      {error && <p role="alert" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--error-text, var(--error))' }}>{error}</p>}
      {!error && (!acceptances || !outstanding) && <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</p>}

      {acceptances && outstanding && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {DOCUMENT_KINDS.map((kind) => {
            const accepted = latestByKind.get(kind);
            const owed = outstanding.has(kind);
            return (
              <li
                key={kind}
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
                }}
              >
                <span style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-primary)' }}>{t(`kind.${kind}`)}</span>
                <span
                  style={{
                    fontSize: 'var(--font-size-small)', padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    background: owed ? 'var(--warning-bg, var(--bg-elevated))' : 'var(--success-bg, var(--bg-elevated))',
                    color: owed ? 'var(--warning-text, var(--text-primary))' : 'var(--success-text, var(--text-primary))',
                  }}
                >
                  {owed
                    ? t('outstanding')
                    : accepted
                      ? t('accepted', { version: accepted.documentVersion, date: fmt.date(accepted.acceptedAt) })
                      : t('notRequired')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default LegalAgreementsPanel;
