import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { SessionGate } from '@/components/guest/SessionGate';
import styles from './DiscoveryTab.module.css';

type Translate = ReturnType<typeof useTranslations>;

/**
 * Everything that differs between the two discovery lists (customer interviews,
 * research notes): the `dashboard.<i18nKey>.*` string group, the three API calls,
 * which row/draft field is the short second input and which is the long body, and
 * how the second field is shown as a badge on a saved row.
 */
export interface KnowledgeListVariant<Row extends { id: string; title: string }> {
  i18nKey: 'interviews' | 'research';
  api: {
    list: () => Promise<Row[]>;
    create: (input: { title: string; meta: string | null; body: string | null }) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };
  /** Placeholder key (under `i18nKey`) for the short second input. */
  metaPlaceholder: string;
  /** Placeholder key (under `i18nKey`) for the long text area. */
  bodyPlaceholder: string;
  rowBody: (row: Row) => string | null | undefined;
  rowBadge: (row: Row, t: Translate, badgeClass: string) => ReactNode;
}

const EMPTY_DRAFT = { title: '', meta: '', body: '' };

/**
 * A self-contained capture list: own rows, draft and busy state, so it drops into
 * the Idea tab (or anywhere else) unchanged. {@link InterviewsTab} and
 * {@link ResearchTab} are this component with their variant.
 */
export function KnowledgeListTab<Row extends { id: string; title: string }>({ variant }: { variant: KnowledgeListVariant<Row> }) {
  const t = useTranslations('dashboard');
  const confirm = useConfirm();
  const { i18nKey: k, api } = variant;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  // Only the FIRST fetch shows the loading state — `loading` starts `true`, so
  // this effect never calls setState synchronously in its own body, only from
  // the promise's resolution. A mutation's reload (below) refreshes the list
  // in place without re-showing the skeleton; `busy` already covers that case.
  useEffect(() => {
    let alive = true;
    api.list()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api]);

  const reload = () => {
    api.list().then(setRows).catch(() => setRows([]));
  };

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn().then(reload).finally(() => setBusy(false));
  };

  const create = () => {
    if (!draft.title.trim()) return;
    run(async () => {
      await api.create({
        title: draft.title.trim(),
        meta: draft.meta.trim() || null,
        body: draft.body.trim() || null,
      });
      setDraft(EMPTY_DRAFT);
    });
  };

  const remove = (id: string) =>
    confirm(t(`${k}.confirmDelete`)).then((ok) => { if (ok) run(() => api.remove(id)); });

  return (
    <div className={styles.root}>
      <SessionGate action="save" variant="block">
        <div className={styles.form}>
          <input
            className={styles.input}
            placeholder={t(`${k}.titlePlaceholder`)}
            value={draft.title}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder={t(`${k}.${variant.metaPlaceholder}`)}
            value={draft.meta}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, meta: e.target.value }))}
          />
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder={t(`${k}.${variant.bodyPlaceholder}`)}
            value={draft.body}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
          <button type="button" className={styles.primaryButton} disabled={busy || !draft.title.trim()} onClick={create}>
            {t(`${k}.add`)}
          </button>
        </div>
      </SessionGate>

      {loading ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{t(`${k}.empty`)}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.card}>
              <div className={styles.cardHead}>
                <strong>{row.title}</strong>
                {variant.rowBadge(row, t, styles.badge)}
                <button type="button" className={styles.ghostButton} disabled={busy} onClick={() => remove(row.id)}>
                  {t(`${k}.delete`)}
                </button>
              </div>
              {variant.rowBody(row) && <p className={styles.cardBody}>{variant.rowBody(row)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
