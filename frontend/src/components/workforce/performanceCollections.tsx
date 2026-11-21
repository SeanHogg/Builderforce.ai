import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { EngagementLevel, MemberEngagement, MemberKind, MemberScorecard } from '@/lib/builderforceApi';
import { assigneeSelectValue } from '@/lib/taskAssignee';
import AssigneeHovercard from './AssigneeHovercard';
import { ENGAGEMENT_LEVEL_COLOR, fmtHrs, fmtScore, scoreColor } from './workforceFormat';
import { MetricPill, MetricRecordCard, cmpNum } from './MetricRecordCard';

/**
 * Collection descriptors for the Performance tab's member scorecards and the
 * unified engagement list (PRD 47). Both are READ-ONLY (`entity: null`): they
 * are derived analytics over members, not an owned catalog with a bulk port.
 */

export const DISCIPLINE_OPTIONS = ['engineering', 'product', 'design', 'qa', 'devops', 'data', 'other'] as const;

/**
 * A scorecard row's identity in the `u:`/`c:`/`h:` select-value vocabulary the shared
 * personality provider is keyed by, so the hovercard here and the ones on the board
 * look themselves up identically.
 */
const memberSelectValue = (m: MemberScorecard): string => assigneeSelectValue(
  m.memberKind === 'host_agent' ? Number(m.memberRef) : null,
  m.memberKind === 'cloud_agent' ? m.memberRef : null,
  m.memberKind === 'human' ? m.memberRef : null,
);

const nameBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start',
  color: 'var(--text-strong)', fontWeight: 600, fontSize: 13,
};

/** Localized label for a discipline value (falls back to the raw value / unassigned). */
export function useDisciplineLabel() {
  const t = useTranslations('workforce');
  return useCallback((d: string | null): string => {
    if (!d || d === 'unassigned') return t('unassigned');
    return (DISCIPLINE_OPTIONS as readonly string[]).includes(d) ? t(`disciplineOptions.${d}` as never) : d;
  }, [t]);
}

export function useScorecardDescriptor(onEdit: (m: MemberScorecard) => void): CollectionDescriptor<MemberScorecard> {
  const t = useTranslations('workforce.performance');
  const disciplineLabel = useDisciplineLabel();
  const tw = useTranslations('workforce');
  return useMemo<CollectionDescriptor<MemberScorecard>>(() => {
    const kindLabel = (k: MemberKind) => t(`kind.${k}` as never);
    // THE PERSON PROFILE SURFACE: the shared hovercard reads the page's one provider
    // map and self-hides for anyone with no personality on file.
    const name = (m: MemberScorecard) => (
      <AssigneeHovercard selectValue={memberSelectValue(m)}>
        <button type="button" style={nameBtn} onClick={() => onEdit(m)} title={t('editProfile')}>{m.memberName}</button>
      </AssigneeHovercard>
    );
    const num = (n: number, color?: string) => <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{n}</span>;
    const score = (n: number | null, strong = false) => (
      <span style={{ color: scoreColor(n), fontWeight: strong ? 700 : undefined, fontVariantNumeric: 'tabular-nums' }}>{fmtScore(n)}</span>
    );
    return {
      entity: null,
      surfaceKey: 'workforce.performance.scorecards',
      rowId: (m) => `${m.memberKind}:${m.memberRef}`,
      label: (m) => m.memberName,
      defaultSort: { key: 'effective', dir: 'desc' },
      emptyKey: 'emptyScorecards',
      columns: [
        { key: 'member', header: t('colMember'), compare: (a, b) => a.memberName.localeCompare(b.memberName), cell: (m) => (
          <div>{name(m)}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{kindLabel(m.memberKind)}</div></div>
        ) },
        { key: 'discipline', header: tw('discipline'), compare: (a, b) => disciplineLabel(a.discipline).localeCompare(disciplineLabel(b.discipline)),
          cell: (m) => <span style={{ color: m.discipline ? undefined : 'var(--text-muted)' }}>{m.discipline ? disciplineLabel(m.discipline) : '—'}</span> },
        { key: 'assigned', header: t('colAssigned'), align: 'end', compare: (a, b) => a.assignedCount - b.assignedCount, cell: (m) => num(m.assignedCount) },
        { key: 'completed', header: t('colCompleted'), align: 'end', compare: (a, b) => a.completedCount - b.completedCount, cell: (m) => num(m.completedCount) },
        { key: 'redo', header: t('colRedo'), align: 'end', compare: (a, b) => a.redoCount - b.redoCount, cell: (m) => num(m.redoCount, m.redoCount > 0 ? 'var(--warning)' : undefined) },
        { key: 'reopen', header: t('colReopen'), align: 'end', compare: (a, b) => a.reopenCount - b.reopenCount, cell: (m) => num(m.reopenCount, m.reopenCount > 0 ? 'var(--danger)' : undefined) },
        { key: 'cycle', header: t('colCycle'), align: 'end', compare: (a, b) => cmpNum(a.avgCycleTimeHours, b.avgCycleTimeHours), cell: (m) => fmtHrs(m.avgCycleTimeHours) },
        { key: 'pickup', header: t('colPickup'), align: 'end', compare: (a, b) => cmpNum(a.avgPickupLatencyHours, b.avgPickupLatencyHours), cell: (m) => fmtHrs(m.avgPickupLatencyHours) },
        { key: 'idleDone', header: t('colIdleDone'), align: 'end', compare: (a, b) => cmpNum(a.avgIdleAfterDoneHours, b.avgIdleAfterDoneHours), cell: (m) => fmtHrs(m.avgIdleAfterDoneHours) },
        { key: 'hygiene', header: t('colHygiene'), align: 'end', compare: (a, b) => cmpNum(a.boardHygieneScore, b.boardHygieneScore), cell: (m) => score(m.boardHygieneScore) },
        { key: 'engage', header: t('colEngage'), align: 'end', compare: (a, b) => cmpNum(a.engagementScore, b.engagementScore), cell: (m) => score(m.engagementScore) },
        { key: 'effective', header: t('colEffective'), align: 'end', compare: (a, b) => cmpNum(a.effectivenessScore, b.effectivenessScore), cell: (m) => score(m.effectivenessScore, true) },
      ],
      card: (m) => (
        <MetricRecordCard
          title={name(m)}
          subtitle={`${kindLabel(m.memberKind)} · ${disciplineLabel(m.discipline)}`}
          badge={<MetricPill color={scoreColor(m.effectivenessScore)}>{t('colEffective')} {fmtScore(m.effectivenessScore)}</MetricPill>}
          stats={[
            { label: t('colAssigned'), value: m.assignedCount },
            { label: t('colCompleted'), value: m.completedCount },
            { label: t('colRedo'), value: m.redoCount, color: m.redoCount > 0 ? 'var(--warning)' : undefined },
            { label: t('colReopen'), value: m.reopenCount, color: m.reopenCount > 0 ? 'var(--danger)' : undefined },
            { label: t('colCycle'), value: fmtHrs(m.avgCycleTimeHours) },
            { label: t('colPickup'), value: fmtHrs(m.avgPickupLatencyHours) },
            { label: t('colIdleDone'), value: fmtHrs(m.avgIdleAfterDoneHours) },
            { label: t('colHygiene'), value: fmtScore(m.boardHygieneScore), color: scoreColor(m.boardHygieneScore) },
            { label: t('colEngage'), value: fmtScore(m.engagementScore), color: scoreColor(m.engagementScore) },
          ]}
        />
      ),
    };
  }, [t, tw, disciplineLabel, onEdit]);
}

// ── Unified engagement ───────────────────────────────────────────────────────

/** The four engagement signal segments, in score order, with their legend colours. */
export const ENGAGEMENT_SEGMENTS = [
  { key: 'activity', color: 'var(--emerald-bright)', cap: 40, pts: (m: MemberEngagement) => m.breakdown.activityPts },
  { key: 'platform', color: 'var(--indigo-bright)', cap: 25, pts: (m: MemberEngagement) => m.breakdown.platformPts },
  { key: 'vscode', color: 'var(--purple-bright)', cap: 20, pts: (m: MemberEngagement) => m.breakdown.toolingPts },
  { key: 'delivery', color: 'var(--amber-bright)', cap: 15, pts: (m: MemberEngagement) => m.breakdown.deliveryPts },
] as const;

function ScoreBar({ m, width = 120 }: { m: MemberEngagement; width?: number | string }) {
  return (
    <span style={{ display: 'inline-flex', width, maxWidth: '100%', height: 8, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--border-subtle)' }}>
      {ENGAGEMENT_SEGMENTS.map((s) => (
        <span key={s.key} style={{ width: `${s.pts(m)}%`, background: s.color, display: 'inline-block', height: '100%' }} title={`${s.pts(m).toFixed(0)} / ${s.cap}`} />
      ))}
    </span>
  );
}

export function useEngagementDescriptor(): CollectionDescriptor<MemberEngagement> {
  const t = useTranslations('workforce.performance.engagement');
  return useMemo<CollectionDescriptor<MemberEngagement>>(() => {
    const levelLabel = (l: EngagementLevel) => t(`level.${l}` as never);
    const vscode = (m: MemberEngagement) => (m.signals.vscodeActive ? <Icon source="🟢" size="1em" /> : '—');
    return {
      entity: null,
      surfaceKey: 'workforce.performance.engagement',
      rowId: (m) => String(m.userId),
      label: (m) => m.displayName,
      defaultSort: { key: 'score', dir: 'desc' },
      emptyKey: 'emptyEngagement',
      columns: [
        { key: 'member', header: t('col.member'), compare: (a, b) => a.displayName.localeCompare(b.displayName), cell: (m) => (
          <div><div style={{ fontWeight: 500 }}>{m.displayName}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.role}</div></div>
        ) },
        { key: 'engagement', header: t('col.engagement'), cell: (m) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ScoreBar m={m} />
            <span style={{ fontSize: 11, fontWeight: 600, color: ENGAGEMENT_LEVEL_COLOR[m.level] }}>{levelLabel(m.level)}</span>
          </div>
        ) },
        { key: 'score', header: t('col.score'), align: 'end', compare: (a, b) => a.score - b.score, cell: (m) => (
          <span style={{ fontWeight: 700, color: ENGAGEMENT_LEVEL_COLOR[m.level] }}>{Math.round(m.score)}</span>
        ) },
        { key: 'activity', header: t('col.activity'), align: 'end', compare: (a, b) => a.signals.activityEvents - b.signals.activityEvents, cell: (m) => m.signals.activityEvents },
        { key: 'platform', header: t('col.platform'), align: 'end', compare: (a, b) => a.signals.platformActions - b.signals.platformActions, cell: (m) => m.signals.platformActions },
        { key: 'vscode', header: t('col.vscode'), align: 'end', compare: (a, b) => Number(a.signals.vscodeActive) - Number(b.signals.vscodeActive), cell: vscode },
        { key: 'completed', header: t('col.completed'), align: 'end', compare: (a, b) => a.signals.completedTasks - b.signals.completedTasks, cell: (m) => m.signals.completedTasks },
      ],
      card: (m) => (
        <MetricRecordCard
          title={m.displayName}
          subtitle={m.role}
          badge={<MetricPill color={ENGAGEMENT_LEVEL_COLOR[m.level]}>{levelLabel(m.level)} · {Math.round(m.score)}</MetricPill>}
          stats={[
            { label: t('col.activity'), value: m.signals.activityEvents },
            { label: t('col.platform'), value: m.signals.platformActions },
            { label: t('col.vscode'), value: vscode(m) },
            { label: t('col.completed'), value: m.signals.completedTasks },
          ]}
          footer={<ScoreBar m={m} width="100%" />}
        />
      ),
    };
  }, [t]);
}
