import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { networkGlyph } from '@/lib/networkGlyph';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { asRecord, compactCount } from './shared';

/**
 * A live social feed tile, merged across every connected account.
 *
 * Same two non-negotiables as the inbox, for the same reason — honesty about what is
 * on screen: the FILTER is shown (a tile reading "12 posts" with no visible filter
 * claims those are all of them), and the read TIME is shown (a live view with no
 * freshness marker is a screenshot claiming to be live). It leads with ENGAGEMENT and
 * the best-performing post rather than a raw list, because "what worked?" is the
 * question a feed on a CMO's board is actually asked.
 */
export function SocialFeedBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const engagement = asRecord(data.engagement, {});
  const top = asRecord(data.topPost, {});
  const accounts = Array.isArray(data.accounts) ? data.accounts.map(String) : [];
  const fetchedAt = typeof data.fetchedAt === 'string' ? new Date(data.fetchedAt) : null;

  if (accounts.length === 0 && posts.length === 0) {
    return <div className={styles.taskContext}><p className={styles.taskEmpty}>{t('socialNotConnected')}</p></div>;
  }
  return <div className={styles.inboxBody}>
    <div className={styles.inboxMeta}>
      <span title={accounts.join(', ')}>{accounts.join(' · ') || t('socialAllAccounts')}</span>
      {fetchedAt && <small>{t('inboxReadAt', { time: fmt.time(fetchedAt) })}</small>}
    </div>
    <div className={styles.campaignStats}>
      <span><small>{t('socialLikes')}</small><b>{compactCount(engagement.likes)}</b></span>
      <span><small>{t('socialComments')}</small><b>{compactCount(engagement.comments)}</b></span>
      <span><small>{t('socialShares')}</small><b>{compactCount(engagement.shares)}</b></span>
    </div>
    {posts.length === 0
      ? <p className={styles.taskEmpty}>{t('socialEmpty')}</p>
      : <ul className={styles.inboxList}>
        {posts.slice(0, 10).map((raw, index) => {
          const post = asRecord(raw, {});
          const metrics = asRecord(post.metrics, {});
          return <li key={String(post.id ?? index)}>
            <div className={styles.inboxRowTop}>
              <b><span className={styles.socialGlyph} aria-hidden>{networkGlyph(post.network)}</span>{String(post.authorName || post.accountName || '')}</b>
              <small>{post.publishedAtISO
                ? fmt.dateWith(String(post.publishedAtISO), { month: 'short', day: 'numeric' })
                : ''}</small>
            </div>
            <p>{String(post.text || '')}</p>
            <div className={styles.socialMetrics}>
              <span>{t('socialLikeCount', { count: Number(metrics.likes) || 0 })}</span>
              <span>{t('socialCommentCount', { count: Number(metrics.comments) || 0 })}</span>
              <span>{t('socialShareCount', { count: Number(metrics.shares) || 0 })}</span>
            </div>
          </li>;
        })}
      </ul>}
    {top.text ? <div className={styles.taskContext}>
      <small>{t('socialTopPost')}</small>
      <p>{String(top.text)}</p>
    </div> : null}
    {posts.length > 10 && <small className={styles.inboxMore}>{t('inboxMore', { count: posts.length - 10 })}</small>}
  </div>;
}
