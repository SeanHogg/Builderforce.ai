import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import type { ComicBranch, ComicPage, ComicState } from '@/lib/creation/comic/comicState';

interface ComicBranchEditorProps {
  state: ComicState;
  page: ComicPage;
  onAdd: () => void;
  onUpdate: (branchId: string, patch: Partial<Omit<ComicBranch, 'id'>>) => void;
  onRemove: (branchId: string) => void;
}

/**
 * The choices a page offers. With none, the reader simply moves on to the next page;
 * with some, it shows them as buttons and follows the one picked. Setting a flag on a
 * branch records that the reader took it.
 */
export function ComicBranchEditor({ state, page, onAdd, onUpdate, onRemove }: ComicBranchEditorProps) {
  const t = useTranslations('canvas.kinds.comic');
  return <div className={`${styles.inspector} nodrag nowheel`}>
    <div className={styles.railHead}>
      <b>{t('choices')}</b>
      <button type="button" className={styles.button} onClick={onAdd}>{t('addChoice')}</button>
    </div>
    {page.branches.length === 0 && <span className={styles.hint}>{t('noChoices')}</span>}
    {page.branches.map((branch, index) => <div key={branch.id} className={styles.bubbleEditor}>
      <div className={styles.row}>
        <input
          type="text"
          value={branch.label}
          placeholder={t('choicePlaceholder')}
          aria-label={t('choiceLabel', { index: index + 1 })}
          onChange={(event) => onUpdate(branch.id, { label: event.target.value })}
        />
        <button type="button" className={styles.iconButton} onClick={() => onRemove(branch.id)} aria-label={t('deleteChoice', { index: index + 1 })} title={t('deleteChoice', { index: index + 1 })}>×</button>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('targetPage')}</span>
          <select value={branch.targetPageId} onChange={(event) => onUpdate(branch.id, { targetPageId: event.target.value })}>
            {state.pages.map((entry, at) => <option key={entry.id} value={entry.id}>{t('pageNumber', { index: at + 1 })}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('flags')}</span>
          <input
            type="text"
            defaultValue={branch.flagsToSet.join(', ')}
            placeholder={t('flagsPlaceholder')}
            onBlur={(event) => onUpdate(branch.id, { flagsToSet: event.target.value.split(',').map((flag) => flag.trim()).filter(Boolean) })}
          />
        </label>
      </div>
    </div>)}
  </div>;
}
