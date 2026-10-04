import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { authoredText } from './shared';

export function ReleaseBody({ data }: CreationBodyProps) {
  const { openDetails } = useCreationNodeActions();
  const onOpen = () => openDetails?.('delivery');
  const t = useTranslations('creationCanvas.node');
  return <div className={styles.releaseBody}>
    <p>{authoredText(data) || t('releaseFallback')}</p>
    <div className={`${styles.nodeActionBar} nodrag nowheel`}><button type="button" onClick={(event) => { event.stopPropagation(); onOpen?.(); }}>{t('deliveryChecklistStep')}</button></div>
  </div>;
}
