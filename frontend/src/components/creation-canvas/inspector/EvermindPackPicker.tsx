import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import { useProjectKnowledgePacks } from '@/lib/knowledge/useProjectKnowledgePacks';
import { provenanceLine } from '@builderforce/agent-tools/knowledge';
import { useFormat } from '@/i18n/useFormat';
import styles from './EvermindPackPicker.module.css';

/**
 * Which uploaded knowledge packs (PRD 40) this Evermind retrieves from. The choice lives on
 * the Evermind node (`data.knowledgePacks`, root ids), so it travels with the board; the
 * canvas turn reads it back (`lib/knowledge/evermindPackRecall.ts`).
 */
export function EvermindPackPicker({ projectId, selected, onChange }: {
  projectId: number;
  selected: readonly string[];
  onChange: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('evermindPacks');
  const format = useFormat();
  const { packs, loading, failed } = useProjectKnowledgePacks(projectId);
  const chosen = new Set(selected);
  const live = new Set(packs.map((p) => p.rootId));
  const toggle = (rootId: string) => {
    // A toggle also drops ids whose pack no longer exists in the project (removed since it was chosen).
    const kept = selected.filter((id) => live.has(id) && id !== rootId);
    onChange({ knowledgePacks: chosen.has(rootId) ? kept : [...kept, rootId] });
  };
  const inUse = packs.filter((p) => chosen.has(p.rootId)).length;
  return (
    <section className={styles.picker} aria-label={t('title')}>
      <h4 className={styles.title}>{t('title')}</h4>
      <p className={styles.hint}>{t('hint')}</p>
      {loading && <p className={styles.hint} role="status">{t('loading')}</p>}
      {failed && <p className={styles.hint} role="alert">{t('failed')}</p>}
      {!loading && !failed && packs.length === 0 && <p className={styles.hint}>{t('empty')}</p>}
      {packs.length > 0 && (
        <ul className={styles.list}>
          {packs.map((pack) => {
            const line = provenanceLine(pack.provenance, (iso) => format.date(iso));
            return (
              <li key={pack.rootId}>
                <button type="button" className={styles.pack} aria-pressed={chosen.has(pack.rootId)} onClick={() => toggle(pack.rootId)}>
                  <span className={styles.packRow}>
                    <span className={styles.packName}>{pack.title}</span>
                    <span className={styles.packState}>{chosen.has(pack.rootId) ? t('selected') : t('select')}</span>
                  </span>
                  {line && <span className={styles.packMeta}>{t(line.key, line.values)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {packs.length > 0 && <p className={styles.summary}>{t('summary', { count: inUse, total: packs.length })}</p>}
    </section>
  );
}
