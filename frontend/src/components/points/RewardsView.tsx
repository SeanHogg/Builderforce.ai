'use client';

import { useTranslations } from 'next-intl';
import { PointsBalanceCard } from './PointsBalanceCard';
import { BadgeGrid } from './BadgeGrid';
import { RewardShelf } from './RewardShelf';
import { PointsActivityList } from './PointsActivityList';
import { EarnRulesList } from './EarnRulesList';
import { PointsLeaderboard } from './PointsLeaderboard';
import styles from './points.module.css';

/**
 * The composed Rewards surface — six self-contained cards on one fluid grid.
 *
 * It is COMPOSITION and nothing else: no state, no fetch, no branching. Each card
 * reads the shared snapshot itself and returns null when it has nothing to say,
 * so this file never grows a condition when a card is added, and any one card can
 * be dropped into another surface on its own.
 *
 * The grid is `auto-fit` over a `min()` track, so it is three columns on a
 * desktop, one at 360px, and nothing overflows in between.
 */
export function RewardsView() {
  const t = useTranslations('points');

  return (
    <div>
      <p className={styles.cardHint}>{t('view.intro')}</p>
      <div className={`${styles.grid} ${styles.gridSpaced}`}>
        <PointsBalanceCard />
        <RewardShelf />
        <BadgeGrid />
        <PointsActivityList />
        <EarnRulesList />
        <PointsLeaderboard />
      </div>
    </div>
  );
}
