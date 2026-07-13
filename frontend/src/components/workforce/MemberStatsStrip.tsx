'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { MemberScorecard, MemberEngagement } from '@/lib/builderforceApi';
import { fmtScore, scoreColor, ENGAGEMENT_LEVEL_COLOR } from './workforceFormat';

/**
 * Compact per-member stats strip shared by every Workforce directory card. Folds
 * the Performance scorecard (effectiveness, engagement, throughput) and the
 * Contributors activity (contribution events) into a single row of chips so the
 * Individual view surfaces the same signals as the Performance and Contributors
 * tabs without leaving the directory. Decides its own visibility: renders null
 * when neither dataset is present (non-managers, or members with no activity).
 */

const chipStyle: CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '4px 8px',
  borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  minWidth: 52,
};
const chipLabel: CSSProperties = { fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 };
const chipValue: CSSProperties = { fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 };

function StatChip({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <span style={chipStyle} title={title}>
      <span style={chipLabel}>{label}</span>
      <span style={{ ...chipValue, color: color ?? 'var(--text-strong)' }}>{value}</span>
    </span>
  );
}

export function MemberStatsStrip({
  scorecard,
  engagement,
}: {
  scorecard?: MemberScorecard;
  engagement?: MemberEngagement;
}) {
  const t = useTranslations('workforce.stats');

  // Activity (contribution events) comes from the engagement signals — the same
  // figure the Contributors leaderboard counts.
  const activity = engagement?.signals.activityEvents;
  const engageScore = engagement?.score ?? scorecard?.engagementScore ?? null;
  const engageColor = engagement ? ENGAGEMENT_LEVEL_COLOR[engagement.level] : scoreColor(engageScore);

  const hasAny =
    scorecard?.effectivenessScore != null ||
    engageScore != null ||
    activity != null ||
    (scorecard != null && scorecard.completedCount > 0);

  if (!hasAny) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {scorecard?.effectivenessScore != null && (
        <StatChip
          label={t('effective')}
          value={fmtScore(scorecard.effectivenessScore)}
          color={scoreColor(scorecard.effectivenessScore)}
          title={t('effectiveTip')}
        />
      )}
      {engageScore != null && (
        <StatChip
          label={t('engagement')}
          value={fmtScore(engageScore)}
          color={engageColor}
          title={t('engagementTip')}
        />
      )}
      {activity != null && (
        <StatChip
          label={t('activity')}
          value={activity.toLocaleString()}
          title={t('activityTip')}
        />
      )}
      {scorecard != null && (
        <StatChip
          label={t('done')}
          value={`${scorecard.completedCount}/${scorecard.assignedCount}`}
          title={t('doneTip')}
        />
      )}
    </div>
  );
}
