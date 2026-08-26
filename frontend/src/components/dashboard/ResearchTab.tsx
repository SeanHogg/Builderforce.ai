'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { discoveryApi, type ResearchNote } from '@/lib/builderforceApi';
import { SessionGate } from '@/components/guest/SessionGate';
import styles from './DiscoveryTab.module.css';

/**
 * Research notes — a competitor teardown, a market stat, a source worth
 * citing toward answering the idea's own question. Self-contained, mirroring
 * `InterviewsTab`'s shape (own list, draft and busy state).
 */
export function ResearchTab() {
  const t = useTranslations('dashboard');
  const confirm = useConfirm();
  const [rows, setRows] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', sourceUrl: '', body: '' });

  // Only the FIRST fetch shows the loading state — see InterviewsTab's
  // identical comment for why the mount effect never calls setState
  // synchronously in its own body.
  useEffect(() => {
    let alive = true;
    discoveryApi.researchNotes.list()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const reload = () => {
    discoveryApi.researchNotes.list().then(setRows).catch(() => setRows([]));
  };

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn().then(reload).finally(() => setBusy(false));
  };

  const create = () => {
    if (!draft.title.trim()) return;
    run(async () => {
      await discoveryApi.researchNotes.create({
        title: draft.title.trim(),
        sourceUrl: draft.sourceUrl.trim() || null,
        body: draft.body.trim() || null,
      });
      setDraft({ title: '', sourceUrl: '', body: '' });
    });
  };

  const remove = (id: string) =>
    confirm(t('research.confirmDelete')).then((ok) => { if (ok) run(() => discoveryApi.researchNotes.remove(id)); });

  return (
    <div className={styles.root}>
      <SessionGate action="save" variant="block">
        <div className={styles.form}>
          <input
            className={styles.input}
            placeholder={t('research.titlePlaceholder')}
            value={draft.title}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder={t('research.sourceUrlPlaceholder')}
            value={draft.sourceUrl}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, sourceUrl: e.target.value }))}
          />
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder={t('research.bodyPlaceholder')}
            value={draft.body}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
          <button type="button" className={styles.primaryButton} disabled={busy || !draft.title.trim()} onClick={create}>
            {t('research.add')}
          </button>
        </div>
      </SessionGate>

      {loading ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{t('research.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <div className={styles.cardHead}>
                <strong>{row.title}</strong>
                {row.sourceUrl && (
                  <a className={styles.badge} href={row.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {t('research.sourceLink')}
                  </a>
                )}
                <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => remove(row.id)}>
                  {t('research.delete')}
                </button>
              </div>
              {row.body && <p className={styles.cardBody}>{row.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
