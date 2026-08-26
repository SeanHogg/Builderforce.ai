'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { discoveryApi, type CustomerInterview } from '@/lib/builderforceApi';
import { SessionGate } from '@/components/guest/SessionGate';
import styles from './DiscoveryTab.module.css';

/**
 * Customer interviews — a conversation with a real person, captured against
 * the idea it is evidence for. Self-contained: owns its own list, draft and
 * busy state, so it drops into the Idea tab (or anywhere else) unchanged.
 */
export function InterviewsTab() {
  const t = useTranslations('dashboard');
  const confirm = useConfirm();
  const [rows, setRows] = useState<CustomerInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', participantName: '', notes: '' });

  // Only the FIRST fetch shows the loading state — `loading` starts `true`, so
  // this effect never calls setState synchronously in its own body, only from
  // the promise's resolution. A mutation's reload (below) refreshes the list
  // in place without re-showing the skeleton; `busy` already covers that case.
  useEffect(() => {
    let alive = true;
    discoveryApi.interviews.list()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const reload = () => {
    discoveryApi.interviews.list().then(setRows).catch(() => setRows([]));
  };

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn().then(reload).finally(() => setBusy(false));
  };

  const create = () => {
    if (!draft.title.trim()) return;
    run(async () => {
      await discoveryApi.interviews.create({
        title: draft.title.trim(),
        participantName: draft.participantName.trim() || null,
        notes: draft.notes.trim() || null,
      });
      setDraft({ title: '', participantName: '', notes: '' });
    });
  };

  const remove = (id: string) =>
    confirm(t('interviews.confirmDelete')).then((ok) => { if (ok) run(() => discoveryApi.interviews.remove(id)); });

  return (
    <div className={styles.root}>
      <SessionGate action="save" variant="block">
        <div className={styles.form}>
          <input
            className={styles.input}
            placeholder={t('interviews.titlePlaceholder')}
            value={draft.title}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder={t('interviews.participantPlaceholder')}
            value={draft.participantName}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, participantName: e.target.value }))}
          />
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder={t('interviews.notesPlaceholder')}
            value={draft.notes}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
          <button type="button" className={styles.primaryButton} disabled={busy || !draft.title.trim()} onClick={create}>
            {t('interviews.add')}
          </button>
        </div>
      </SessionGate>

      {loading ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{t('interviews.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <div className={styles.cardHead}>
                <strong>{row.title}</strong>
                {row.participantName && <span className={styles.badge}>{row.participantName}</span>}
                <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => remove(row.id)}>
                  {t('interviews.delete')}
                </button>
              </div>
              {row.notes && <p className={styles.cardBody}>{row.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
