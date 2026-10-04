import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { networkGlyph } from '@/lib/networkGlyph';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { asRecord, textValue } from './shared';

/**
 * A social campaign tile. Counters lead for the same reason the email campaign's do —
 * "did it go out, and where?" is the only question it is asked — and each target shows
 * its own outcome, because "3 of 5 published" without saying WHICH three is unusable.
 */
export function SocialCampaignBody({ data }: CreationBodyProps) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas.node');
  const posts = Array.isArray(data.posts) ? data.posts : [];
  // Blockers arrive as CODES so they can be read in the viewer's language. A legacy
  // string (an older saved board, or an email campaign's flat list) is shown as-is
  // rather than dropped — an unreadable reason still beats a silent one.
  const blockers = (Array.isArray(data.blockers) ? data.blockers : []).map((raw) => {
    if (typeof raw === 'string') return raw;
    const blocker = asRecord(raw, {});
    const code = String(blocker.code ?? '');
    return code
      ? t(`socialBlocker.${code}` as never, {
        network: String(blocker.network ?? ''),
        account: String(blocker.account ?? ''),
        fields: String(blocker.fields ?? ''),
      } as never)
      : '';
  }).filter(Boolean);
  const stat = (value: unknown) => String(Number(value) || 0);
  const scheduledAt = textValue(data.scheduledAt);
  return <div className={styles.taskBody}>
    <div className={styles.campaignStats}>
      <span><small>{t('socialPublishedCount')}</small><b>{stat(data.publishedCount)}/{stat(data.targets ?? posts.length)}</b></span>
      <span><small>{t('campaignFailed')}</small><b>{stat(data.failedCount)}</b></span>
      <span><small>{t('socialScheduled')}</small><b>{scheduledAt ? fmt.date(scheduledAt) : '—'}</b></span>
    </div>
    {textValue(data.body) && <div className={styles.taskContext}><small>{t('socialCopy')}</small><p>{String(data.body)}</p></div>}
    {posts.length > 0 && <ul className={styles.socialTargets}>
      {posts.slice(0, 8).map((raw, index) => {
        const post = asRecord(raw, {});
        const status = String(post.status ?? 'queued');
        return <li key={String(post.id ?? index)} data-status={status}>
          <span aria-hidden>{networkGlyph(post.network)}</span>
          <b>{String(post.accountName || post.network || '')}</b>
          {post.permalink
            ? <a href={String(post.permalink)} target="_blank" rel="noreferrer noopener">{t(`socialStatus.${status}`)}</a>
            : <small>{t(`socialStatus.${status}`)}</small>}
        </li>;
      })}
    </ul>}
    {blockers.length > 0 && <div className={styles.taskContext}><small>{t('campaignBlocked')}</small><p>{blockers.join(' · ')}</p></div>}
  </div>;
}
