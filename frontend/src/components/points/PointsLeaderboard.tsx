'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/AuthContext';
import { fetchPointsLeaderboard, type LeaderboardRow } from '@/lib/pointsApi';
import styles from './points.module.css';

/**
 * The workspace standing.
 *
 * ── WHY THIS ONE FETCHES ON ITS OWN ──────────────────────────────────────────
 * Every other points card projects the shared `GET /api/points` snapshot. The
 * leaderboard is the one cross-member read, it is the most expensive query behind
 * this surface, and most people never open the tab it lives on — so folding it
 * into the shared summary would make every balance chip on the platform pay for a
 * grouped scan nobody asked for. It has its own endpoint, its own five-minute
 * server cache, and it loads when it mounts.
 *
 * It shows refs and totals only. No actions, no timestamps: a leaderboard must
 * not become a way to watch what a colleague did today.
 */
export function PointsLeaderboard() {
  const t = useTranslations('points');
  const hasTenant = useOptionalAuth()?.hasTenant ?? false;
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  useEffect(() => {
    if (!hasTenant) return;
    let active = true;
    fetchPointsLeaderboard(10)
      .then((data) => { if (active) setRows(data); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [hasTenant]);

  if (!hasTenant || !rows || rows.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="points-leaderboard-heading">
      <h3 id="points-leaderboard-heading" className={styles.cardTitle}>{t('leaderboard.title')}</h3>
      <ol className={styles.activityList}>
        {rows.map((row) => (
          <li key={row.userRef} className={styles.activityRow}>
            <span className={styles.activityLabel}>
              {t('leaderboard.rank', { rank: row.rank })} · {row.userRef}
            </span>
            <span className={styles.earnValue}>{row.points.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
