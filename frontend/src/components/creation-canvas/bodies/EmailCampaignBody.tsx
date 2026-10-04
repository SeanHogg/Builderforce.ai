import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
// The consent state a send is gated on, read off the bound `audience` card rather than
// copied onto the campaign — see `canvasMarketing.ts`.
import { campaignSendReadiness } from '@/lib/canvasMarketing';
import type { CreationBodyProps } from './types';
import { useBoardNeighbours } from './boardSubscriptions';
import { textValue } from './shared';

/**
 * A campaign tile. The counters lead, because "did it go out and did anyone
 * read it?" is the only question a campaign object is ever asked, and
 * `blockers` says plainly why a draft cannot send yet.
 */
export function EmailCampaignBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const blockers = Array.isArray(data.blockers) ? data.blockers.map(String) : [];
  const stat = (value: unknown) => String(Number(value) || 0);
  // ── THE CONSENT STATE, AT THE POINT OF SEND ─────────────────────────────────────
  // A campaign could be authored and fired from this board with no visible consent or
  // unsubscribe state at all, which is a CAN-SPAM/GDPR exposure created by the surface
  // rather than by the sender. So the card reads the bound `audience` — never a copy of
  // its numbers, which an LLM patch could write to zero — and says out loud how many may
  // lawfully be mailed and what is stopping the send.
  const neighbours = useBoardNeighbours(true);
  const readiness = campaignSendReadiness({ data }, neighbours.map((entry) => ({ data: entry })));
  return <div className={styles.taskBody}>
    <div className={styles.campaignStats}>
      <span><small>{t('campaignSent')}</small><b>{stat(data.sent)}/{stat(data.recipients)}</b></span>
      <span><small>{t('campaignOpened')}</small><b>{stat(data.opened)}</b></span>
      <span><small>{t('campaignClicked')}</small><b>{stat(data.clicked)}</b></span>
    </div>
    <div className={styles.taskFacts}>
      <span><small>{t('campaignAudience')}</small><b>{textValue(data.audienceName, '—')}</b></span>
      <span><small>{t('campaignVia')}</small><b>{textValue(data.transport, 'platform')}</b></span>
    </div>
    <div className={styles.taskFacts}>
      <span><small>{t('campaignSendable')}</small><b>{readiness.sendable === undefined ? '—' : String(readiness.sendable)}</b></span>
      <span><small>{t('campaignConsent')}</small><b>{readiness.ready ? t('campaignConsentOk') : t('campaignConsentBlocked')}</b></span>
    </div>
    {textValue(data.subject) && <div className={styles.taskContext}><small>{t('campaignSubject')}</small><b>{String(data.subject)}</b></div>}
    {readiness.blockers.length > 0 && <div className={styles.taskContext}>
      <small>{t('campaignConsentBlocked')}</small>
      <p>{readiness.blockers.map((blocker) => t(`campaignBlocker.${blocker}`)).join(' · ')}</p>
    </div>}
    {blockers.length > 0 && <div className={styles.taskContext}><small>{t('campaignBlocked')}</small><p>{blockers.join(' · ')}</p></div>}
  </div>;
}
