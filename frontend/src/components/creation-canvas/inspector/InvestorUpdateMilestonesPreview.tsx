import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { getPendingInvestorMilestones, type PendingInvestorMilestones } from '@/lib/investorMilestonesApi';
import styles from '../styles/inspector.module.css';

/**
 * Presentational half: the milestones that will go out with the next investor update.
 * Board entries carry their board and earned points; a work item shows its key.
 */
export function InvestorUpdateMilestonesView({ pending }: { pending: PendingInvestorMilestones }) {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  return (
    <section className={styles.milestonesPreview} aria-label={t('investorMilestonesHeading')}>
      <h4>{t('investorMilestonesHeading')}</h4>
      {pending.milestones.length === 0
        ? <p className={styles.inspectorHint}>{t('investorMilestonesEmpty')}</p>
        : <ul>
          {pending.milestones.map((m) => (
            <li key={`${m.source}:${m.id}`}>
              <strong>{m.title}</strong>
              <small>
                {m.source === 'board'
                  ? t('investorMilestoneBoardLine', { board: m.boardName, points: fmt.number(m.earnedPoints) })
                  : m.key}
                {' · '}{fmt.dateTime(m.reachedAt)}
              </small>
            </li>
          ))}
        </ul>}
      {pending.moreCount > 0 && <p className={styles.inspectorHint}>{t('investorMilestonesMore', { count: pending.moreCount })}</p>}
    </section>
  );
}

/**
 * Container: fetches the pending milestones. Renders nothing while loading, on a 403
 * (the caller may not see investor data) or on any other failure — a preview must never
 * block composing the update.
 */
export function InvestorUpdateMilestonesPreview() {
  const [pending, setPending] = useState<PendingInvestorMilestones | null>(null);
  useEffect(() => {
    let active = true;
    void getPendingInvestorMilestones().then(
      (result) => { if (active) setPending(result); },
      () => { /* A 403 or any failure hides the preview. */ },
    );
    return () => { active = false; };
  }, []);
  return pending ? <InvestorUpdateMilestonesView pending={pending} /> : null;
}
