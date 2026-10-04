import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { textValue } from './shared';

export function MockupBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const project = textValue(data.deliveryProjectName, 'BuilderForce launch');
  const agent = textValue(data.mockupAgentName, 'Campaign Strategist');
  return <>
    <div className={styles.mockupGrid}><i /><i /><i /></div>
    <p>{data.subtitle || t('mockupFallback')}</p>
    <div className={styles.pills}><span>{data.status || t('draft')}</span><span>{t('projectPrefix', { name: project })}</span><span>{t('agentPrefix', { name: agent })}</span></div>
  </>;
}
