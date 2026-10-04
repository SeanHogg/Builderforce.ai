import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { networkGlyph } from '@/lib/networkGlyph';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { asRecord, textValue, compactCount } from './shared';

/** One pinned post. Unlike the feed tile this does NOT change — that is the reason
 *  it exists — so it shows the full text and its engagement at the time it was read. */
export function SocialPostBody({ data }: CreationBodyProps) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const metrics = asRecord(data.metrics, {});
  const permalink = textValue(data.permalink);
  const thumbnail = textValue(data.thumbnailUrl);
  return <div className={styles.taskBody}>
    <div className={styles.taskFacts}>
      <span><small>{t('socialAccount')}</small><b>{`${networkGlyph(data.network)} ${textValue(data.accountName, '—')}`}</b></span>
      <span><small>{t('socialPublished')}</small><b>{data.publishedAt ? fmt.date(String(data.publishedAt)) : '—'}</b></span>
    </div>
    {thumbnail && <img className={styles.socialMedia} src={thumbnail} alt="" width={240} height={120} />}
    <div className={styles.taskContext}>
      <small>{t('socialPostText')}</small>
      {textValue(data.text)
        ? <p className={styles.emailBodyText}>{String(data.text)}</p>
        : <p className={styles.taskEmpty}>{t('socialNoText')}</p>}
    </div>
    <div className={styles.campaignStats}>
      <span><small>{t('socialLikes')}</small><b>{compactCount(metrics.likes)}</b></span>
      <span><small>{t('socialComments')}</small><b>{compactCount(metrics.comments)}</b></span>
      <span><small>{t('socialShares')}</small><b>{compactCount(metrics.shares)}</b></span>
    </div>
    {permalink && <a className={styles.inboxOpenLink} href={permalink} target="_blank" rel="noreferrer noopener">{t('socialOpenPost')}</a>}
  </div>;
}
