import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { textValue } from './shared';

/** A template tile. `mergeFields` is the load-bearing part: it is the contract
 *  the audience has to satisfy, and seeing it here is what stops a send that
 *  renders `{{company}}` as a gap in four thousand inboxes. */
export function EmailTemplateBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const fields = Array.isArray(data.mergeFields) ? data.mergeFields.map(String) : [];
  const logoUrl = textValue(data.logoUrl);
  return <div className={styles.taskBody}>
    {logoUrl && <img className={styles.templateLogo} src={logoUrl} alt="" width={136} height={34} />}
    <div className={styles.taskContext}>
      <small>{t('templateSubject')}</small>
      <b>{textValue(data.subject, t('templateNoSubject'))}</b>
    </div>
    <div className={styles.taskContext}>
      <small>{t('templateMergeFields')}</small>
      {fields.length
        ? <div className={styles.pills}>{fields.slice(0, 8).map((field) => <span key={field}>{`{{${field}}}`}</span>)}</div>
        : <p className={styles.taskEmpty}>{t('templateNoMergeFields')}</p>}
    </div>
  </div>;
}
