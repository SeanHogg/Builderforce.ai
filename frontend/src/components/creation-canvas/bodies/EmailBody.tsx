import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import type { CreationBodyProps } from './types';
import { textValue } from './shared';

/** One pinned message. Unlike the inbox tile this does NOT change — that is the
 *  reason it exists — so it shows the full body rather than an excerpt. */
export function EmailBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const body = textValue(data.bodyText);
  const to = Array.isArray(data.to) ? data.to.map(String) : [];
  const webUrl = textValue(data.webUrl);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>{t('emailFrom')}</small><b>{textValue(data.from, t('inboxUnknownSender'))}</b></span>
      <span><small>{t('emailTo')}</small><b>{to.join(', ') || '—'}</b></span>
    </div>
    <div className={styles.taskContext}>
      <small>{t('emailBody')}</small>
      {body ? <p className={styles.emailBodyText}>{body}</p> : <p className={styles.taskEmpty}>{t('emailNoBody')}</p>}
    </div>
    {webUrl && <a className={styles.inboxOpenLink} href={webUrl} target="_blank" rel="noreferrer noopener">{t('emailOpenInProvider')}</a>}
  </div>;
}
