'use client';

// Required directive — see the note in `SourcedJobsList`. These cards mount from
// canvas surfaces and embedded apps, not only from the hiring console.

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { useConfirm } from '@/components/ConfirmProvider';
import { useOptionalAuth } from '@/lib/AuthContext';
import {
  deleteJobSource, fetchJobSources, saveJobSource, syncJobSource, type JobBoardSource,
} from '@/lib/sourcingApi';
import styles from './sourcing.module.css';

/**
 * The feeds a workspace pulls jobs from — add, sync, remove.
 *
 * ── WHY THE FAILURE OF A FEED IS ON THE ROW, NOT IN A TOAST ──────────────────
 * A feed fails on a schedule, at three in the morning, repeatedly. A toast shows
 * that to whoever happened to click sync; the row shows it to whoever next opens
 * the page, which is the person who can fix it. `lastError` comes back on every
 * listing for exactly that reason.
 *
 * ── THE API KEY IS WRITE-ONLY ────────────────────────────────────────────────
 * The server never returns it — only `hasApiKey`. So the field is always blank
 * on load and an empty submit leaves the stored key alone, which is what makes
 * "edit the name of a feed" not silently destroy its credential.
 */
export function JobSourcesPanel() {
  const t = useTranslations('sourcing');
  const fmt = useFormat();
  const confirm = useConfirm();
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;

  const [sources, setSources] = useState<JobBoardSource[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'rss' | 'json'>('rss');
  const [itemsPath, setItemsPath] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    fetchJobSources()
      .then(setSources)
      // A member without the manager role gets a 403 here, which is not an error
      // worth shouting about — the card simply has nothing to show them.
      .catch(() => setSources([]));
  }, []);

  useEffect(() => { if (hasTenant) load(); }, [hasTenant, load]);

  // No session, still loading, or not entitled — all three mean "render nothing".
  if (!hasTenant || sources === null) return null;

  const add = async () => {
    setBusy('new'); setError(''); setNotice('');
    try {
      await saveJobSource({
        name: name.trim(),
        url: url.trim(),
        format,
        ...(itemsPath.trim() ? { itemsPath: itemsPath.trim() } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
      setName(''); setUrl(''); setItemsPath(''); setApiKey('');
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sources.saveFailed'));
    } finally { setBusy(null); }
  };

  const sync = async (id: number) => {
    setBusy(id); setError(''); setNotice('');
    try {
      const result = await syncJobSource(id);
      // The request succeeded and the FEED may still have failed. Those are
      // different outcomes and the operator needs to be told which one happened.
      if (result.error) setError(t('sources.syncFailed', { detail: result.error }));
      else setNotice(t('sources.synced', { fetched: result.fetched, written: result.written }));
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sources.syncFailed', { detail: '' }));
    } finally { setBusy(null); }
  };

  const remove = async (source: JobBoardSource) => {
    const ok = await confirm({
      title: t('sources.removeTitle'),
      message: t('sources.removeMessage', { name: source.name }),
      confirmLabel: t('sources.removeAction'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(source.id); setError('');
    try {
      await deleteJobSource(source.id);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sources.removeFailed'));
    } finally { setBusy(null); }
  };

  return (
    <section className={styles.card} aria-labelledby="job-sources-heading">
      <h3 id="job-sources-heading" className={styles.cardTitle}>{t('sources.title')}</h3>
      <p className={styles.cardHint}>{t('sources.intro')}</p>

      {sources.length === 0 ? (
        <p className={styles.empty}>{t('sources.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {sources.map((source) => (
            <li key={source.id} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{source.name}</span>
                <span className={styles.rowNote}>
                  {source.format.toUpperCase()}
                  {source.hasApiKey && ` · ${t('sources.authenticated')}`}
                  {source.lastSyncedAt
                    ? ` · ${t('sources.lastSynced', { when: fmt.dateTime(source.lastSyncedAt) })}`
                    : ` · ${t('sources.neverSynced')}`}
                </span>
                {source.lastError && (
                  <span className={styles.warn}>{t('sources.lastError', { detail: source.lastError })}</span>
                )}
              </div>
              <div className={styles.buttonRow}>
                <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void sync(source.id)}>
                  {busy === source.id ? t('sources.syncing') : t('sources.sync')}
                </button>
                <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void remove(source)}>
                  {t('sources.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.form}>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-source-name">{t('sources.name')}</label>
            <input id="job-source-name" className={styles.input} value={name}
              onChange={(e) => setName(e.target.value)} placeholder={t('sources.namePlaceholder')} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-source-format">{t('sources.format')}</label>
            <select id="job-source-format" className={styles.select} value={format}
              onChange={(e) => setFormat(e.target.value === 'json' ? 'json' : 'rss')}>
              <option value="rss">{t('sources.formatRss')}</option>
              <option value="json">{t('sources.formatJson')}</option>
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="job-source-url">{t('sources.url')}</label>
          <input id="job-source-url" className={styles.input} type="url" value={url}
            onChange={(e) => setUrl(e.target.value)} placeholder={t('sources.urlPlaceholder')} />
        </div>

        {format === 'json' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="job-source-items">{t('sources.itemsPath')}</label>
            <input id="job-source-items" className={styles.input} value={itemsPath}
              onChange={(e) => setItemsPath(e.target.value)} placeholder={t('sources.itemsPathPlaceholder')} />
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="job-source-key">{t('sources.apiKey')}</label>
          <input id="job-source-key" className={styles.input} type="password" autoComplete="off"
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('sources.apiKeyPlaceholder')} />
        </div>

        <button type="button" className={styles.button}
          disabled={busy !== null || !name.trim() || !url.trim()}
          onClick={() => void add()}>
          {busy === 'new' ? t('sources.adding') : t('sources.add')}
        </button>
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
