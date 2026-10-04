import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';

/**
 * A sticky note: its text, on its pigment, and nothing else.
 *
 * The text lives in `title` rather than `content` because a sticky HAS no second
 * field — see the kind's note in the contract. The header is hidden by
 * `.node_sticky` in CSS rather than branched around here, so the card keeps one
 * structure and the sticky just declines to draw the chrome.
 *
 * `nodrag`/`nowheel` are what let a person select and scroll text inside a node
 * React Flow would otherwise pan the board with.
 */
export function StickyBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.sticky');
  const text = typeof data.title === 'string' ? data.title : '';
  if (!onEdit) return <p className={styles.stickyText}>{text || t('empty')}</p>;
  return <textarea
    className={`${styles.stickyInput} nodrag nowheel`}
    value={text}
    aria-label={t('label')}
    placeholder={t('placeholder')}
    onChange={(event) => onEdit({ title: event.target.value })}
  />;
}
