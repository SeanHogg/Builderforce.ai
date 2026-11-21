import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type {
  AllocationHealthRow,
  CollaborationRow,
  DocActivityRow,
  LaborByMember,
  PerformerRow,
  PerformerTier,
} from '@/lib/builderforceApi';
import { hrs, pct, useInsightFormat } from '@/components/insights/format';
import { toneColor, type StatusTone } from '@/lib/statusTone';
import { MetricPill, MetricRecordCard, cmpNum } from './MetricRecordCard';

/**
 * Collection descriptors for the EMP metrics lenses (EMP-12..19) on the
 * Performance tab (PRD 47). All READ-ONLY (`entity: null`): derived analytics
 * per member, no bulk port. One descriptor per record type.
 */

const DANGER = 'var(--danger)';
const WARN = 'var(--warning)';
const memberKey = (m: { memberKind: string; memberRef: string }) => `${m.memberKind}:${m.memberRef}`;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const strong = (v: React.ReactNode, color?: string) => <span style={{ fontWeight: 700, color }}>{v}</span>;

/** Search text shared by every EMP member row. */
export const empMemberSearch = (m: { name: string }) => m.name;

function UtilizationBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 'var(--radius-sm)', background: 'var(--border-subtle)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
    </div>
  );
}

// ── EMP-12 — over-allocation ─────────────────────────────────────────────────
export function useAllocationDescriptor(): CollectionDescriptor<AllocationHealthRow> {
  const t = useTranslations('components.emp');
  return useMemo<CollectionDescriptor<AllocationHealthRow>>(() => {
    const utilColor = (m: AllocationHealthRow) => (m.overAllocated ? DANGER : m.utilizationPct >= 80 ? WARN : undefined);
    const overBadge = <MetricPill color={DANGER}>{t('overAllocated')}</MetricPill>;
    return {
      entity: null,
      surfaceKey: 'workforce.emp.allocation',
      rowId: memberKey,
      label: (m) => m.name,
      defaultSort: { key: 'utilization', dir: 'desc' },
      emptyKey: 'emptyEmpData',
      columns: [
        { key: 'member', header: t('member'), compare: byName, cell: (m) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{m.name}{m.overAllocated && overBadge}</span>
        ) },
        { key: 'wip', header: t('wip'), align: 'end', compare: (a, b) => a.observedWip - b.observedWip, cell: (m) => m.observedWip },
        { key: 'max', header: t('max'), align: 'end', compare: (a, b) => a.maxWip - b.maxWip, cell: (m) => <span style={{ color: 'var(--text-muted)' }}>{m.maxWip}</span> },
        { key: 'utilization', header: t('utilization'), align: 'end', compare: (a, b) => a.utilizationPct - b.utilizationPct, cell: (m) => strong(pct(m.utilizationPct), utilColor(m)) },
      ],
      card: (m) => (
        <MetricRecordCard
          title={m.name}
          badge={m.overAllocated ? overBadge : undefined}
          stats={[
            { label: t('wip'), value: m.observedWip },
            { label: t('max'), value: m.maxWip },
            { label: t('utilization'), value: pct(m.utilizationPct), color: utilColor(m), strong: true },
          ]}
          footer={<UtilizationBar value={m.utilizationPct} color={utilColor(m) ?? 'var(--success)'} />}
        />
      ),
    };
  }, [t]);
}

// ── EMP-14 — collaboration ───────────────────────────────────────────────────
export function useCollaborationDescriptor(): CollectionDescriptor<CollaborationRow> {
  const t = useTranslations('components.emp');
  const { int } = useInsightFormat();
  return useMemo<CollectionDescriptor<CollaborationRow>>(() => ({
    entity: null,
    surfaceKey: 'workforce.emp.collaboration',
    rowId: memberKey,
    label: (m) => m.name,
    defaultSort: { key: 'score', dir: 'desc' },
    emptyKey: 'emptyEmpData',
    columns: [
      { key: 'member', header: t('member'), compare: byName, cell: (m) => m.name },
      { key: 'reviews', header: t('reviews'), align: 'end', compare: (a, b) => a.prsReviewed - b.prsReviewed, cell: (m) => m.prsReviewed },
      { key: 'comments', header: t('comments'), align: 'end', compare: (a, b) => a.reviewComments - b.reviewComments, cell: (m) => m.reviewComments },
      { key: 'handoffs', header: t('handoffs'), align: 'end', compare: (a, b) => a.handoffs - b.handoffs, cell: (m) => m.handoffs },
      { key: 'turnaround', header: t('turnaround'), align: 'end', compare: (a, b) => cmpNum(a.avgReviewTurnaroundHours, b.avgReviewTurnaroundHours),
        cell: (m) => <span style={{ color: 'var(--text-muted)' }}>{hrs(m.avgReviewTurnaroundHours)}</span> },
      { key: 'score', header: t('score'), align: 'end', compare: (a, b) => a.collaborationScore - b.collaborationScore, cell: (m) => strong(int(m.collaborationScore)) },
    ],
    card: (m) => (
      <MetricRecordCard
        title={m.name}
        badge={<MetricPill color="var(--accent)">{t('score')} {int(m.collaborationScore)}</MetricPill>}
        stats={[
          { label: t('reviews'), value: m.prsReviewed },
          { label: t('comments'), value: m.reviewComments },
          { label: t('handoffs'), value: m.handoffs },
          { label: t('turnaround'), value: hrs(m.avgReviewTurnaroundHours) },
        ]}
      />
    ),
  }), [t, int]);
}

// ── EMP-17 — documentation activity ──────────────────────────────────────────
export function useDocActivityDescriptor(): CollectionDescriptor<DocActivityRow> {
  const t = useTranslations('components.emp');
  const { int } = useInsightFormat();
  return useMemo<CollectionDescriptor<DocActivityRow>>(() => ({
    entity: null,
    surfaceKey: 'workforce.emp.docActivity',
    rowId: (m) => m.memberRef,
    label: (m) => m.name,
    defaultSort: { key: 'score', dir: 'desc' },
    emptyKey: 'emptyEmpData',
    columns: [
      { key: 'member', header: t('member'), compare: byName, cell: (m) => m.name },
      { key: 'authored', header: t('authored'), align: 'end', compare: (a, b) => a.docsAuthored - b.docsAuthored, cell: (m) => m.docsAuthored },
      { key: 'edits', header: t('edits'), align: 'end', compare: (a, b) => a.edits - b.edits, cell: (m) => m.edits },
      { key: 'acks', header: t('acks'), align: 'end', compare: (a, b) => a.acksGiven - b.acksGiven, cell: (m) => m.acksGiven },
      { key: 'score', header: t('score'), align: 'end', compare: (a, b) => a.score - b.score, cell: (m) => strong(int(m.score)) },
    ],
    card: (m) => (
      <MetricRecordCard
        title={m.name}
        badge={<MetricPill color="var(--accent)">{t('score')} {int(m.score)}</MetricPill>}
        stats={[
          { label: t('authored'), value: m.docsAuthored },
          { label: t('edits'), value: m.edits },
          { label: t('acks'), value: m.acksGiven },
        ]}
      />
    ),
  }), [t, int]);
}

// ── EMP-19 — labour cost per member ──────────────────────────────────────────
export function useLaborCostDescriptor(): CollectionDescriptor<LaborByMember> {
  const t = useTranslations('components.emp');
  const { usd } = useInsightFormat();
  return useMemo<CollectionDescriptor<LaborByMember>>(() => ({
    entity: null,
    surfaceKey: 'workforce.emp.laborCost',
    rowId: memberKey,
    label: (m) => m.name,
    defaultSort: { key: 'cost', dir: 'desc' },
    emptyKey: 'emptyEmpData',
    columns: [
      { key: 'member', header: t('member'), compare: byName, cell: (m) => m.name },
      { key: 'effort', header: t('effortH'), align: 'end', compare: (a, b) => a.effortHours - b.effortHours, cell: (m) => m.effortHours.toFixed(1) },
      { key: 'tasks', header: t('tasks'), align: 'end', compare: (a, b) => a.taskCount - b.taskCount, cell: (m) => m.taskCount },
      { key: 'cost', header: t('cost'), align: 'end', compare: (a, b) => a.costUsd - b.costUsd, cell: (m) => strong(usd(m.costUsd)) },
    ],
    card: (m) => (
      <MetricRecordCard
        title={m.name}
        stats={[
          { label: t('cost'), value: usd(m.costUsd), strong: true },
          { label: t('effortH'), value: m.effortHours.toFixed(1) },
          { label: t('tasks'), value: m.taskCount },
        ]}
      />
    ),
  }), [t, usd]);
}

// ── EMP-16 — performer tiers ─────────────────────────────────────────────────
const PERFORMER_TIER_TONE: Record<PerformerTier, StatusTone> = { high: 'success', solid: 'accent', watch: 'danger' };
export const TIER_COLOR = Object.fromEntries(
  Object.entries(PERFORMER_TIER_TONE).map(([tier, tone]) => [tier, toneColor(tone, 'solid')]),
) as Record<PerformerTier, string>;
const TIER_ORDER: Record<PerformerTier, number> = { watch: 0, solid: 1, high: 2 };

export function useTierLabel() {
  const t = useTranslations('components.emp');
  return useMemo(() => (tier: PerformerTier) => t(`tier${tier[0].toUpperCase()}${tier.slice(1)}` as 'tierHigh'), [t]);
}

export function usePerformersDescriptor(openKey: string | null, onToggleNotes: (key: string) => void): CollectionDescriptor<PerformerRow> {
  const t = useTranslations('components.emp');
  const { int } = useInsightFormat();
  const tierLabel = useTierLabel();
  return useMemo<CollectionDescriptor<PerformerRow>>(() => {
    const tierBadge = (m: PerformerRow) => (
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-on-accent)', background: TIER_COLOR[m.tier], padding: '1px 8px', borderRadius: 'var(--radius-full)' }}>{tierLabel(m.tier)}</span>
    );
    const notesBtn = (m: PerformerRow) => {
      const key = memberKey(m);
      return (
        <button type="button" aria-expanded={openKey === key} onClick={() => onToggleNotes(key)} style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {t('addNote')}
        </button>
      );
    };
    return {
      entity: null,
      surfaceKey: 'workforce.emp.performers',
      rowId: memberKey,
      label: (m) => m.name,
      defaultSort: { key: 'composite', dir: 'desc' },
      emptyKey: 'emptyEmpData',
      columns: [
        { key: 'member', header: t('member'), compare: byName, cell: (m) => m.name },
        { key: 'tier', header: t('tier'), align: 'end', compare: (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier], cell: tierBadge },
        { key: 'percentile', header: t('percentile'), align: 'end', compare: (a, b) => a.percentile - b.percentile, cell: (m) => pct(m.percentile) },
        { key: 'composite', header: t('composite'), align: 'end', compare: (a, b) => a.composite - b.composite, cell: (m) => strong(int(m.composite)) },
        { key: 'notes', header: '', align: 'end', cell: notesBtn },
      ],
      card: (m) => (
        <MetricRecordCard
          title={m.name}
          badge={tierBadge(m)}
          stats={[
            { label: t('composite'), value: int(m.composite), strong: true },
            { label: t('percentile'), value: pct(m.percentile) },
          ]}
          footer={<div>{notesBtn(m)}</div>}
        />
      ),
    };
  }, [t, int, tierLabel, openKey, onToggleNotes]);
}
