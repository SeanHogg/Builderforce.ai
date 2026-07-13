'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pmoApi, type SpineNode, type SpineResult } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { usePmScope } from '@/lib/pm/scope';
import { COST_CLASS_COLORS, formatUsd } from '@/lib/pm/costClass';
import { parseDate, startOfDay, formatShort } from '@/lib/schedule';
import { PmEmpty, PmError } from './pmShared';

/**
 * Unified planning Gantt (0225) — objective → initiative → epic → task as ONE
 * nested timeline. Every level is a dated bar coloured by its effective
 * CAPEX/OPEX class, with rolled-up $ at every node and an anomaly marker where a
 * child's class contradicts its parent. Collapsible. Reads /api/pmo/spine (the
 * same payload the reconciliation stage uses), so the Gantt and the books agree.
 */
const PX_PER_DAY = 7;
const NAME_COL = 320;
const ROW_H = 30;
const DAY_MS = 86_400_000;

const KIND_ICON: Record<SpineNode['kind'], string> = {
  portfolio: '📁', objective: '🎯', initiative: '🚩', epic: '🧩', task: '▫️', roadmap: '📍',
};

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

function monthSegments(start: Date, end: Date): Array<{ label: string; days: number }> {
  const segments: Array<{ label: string; days: number }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = startOfDay(end);
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
  while (cursor <= last) {
    const monthStart = cursor < startOfDay(start) ? startOfDay(start) : cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const segEnd = monthEnd > last ? last : monthEnd;
    segments.push({ label: fmt.format(cursor), days: daysBetween(monthStart, segEnd) + 1 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return segments;
}

export function PlanningSpineGantt() {
  const t = useTranslations('spine');
  const { projectId } = usePmScope();
  const { data, error } = usePmData<SpineResult>(() => pmoApi.spine(projectId), [projectId]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const exportCsv = async () => {
    const csv = await pmoApi.exportSpineCsv({ projectId });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'capex-opex.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const { childrenByParent, roots } = useMemo(() => {
    const byParent = new Map<string | null, SpineNode[]>();
    const present = new Set((data?.nodes ?? []).map((n) => n.key));
    for (const n of data?.nodes ?? []) {
      const parent = n.parentKey && present.has(n.parentKey) ? n.parentKey : null;
      const list = byParent.get(parent) ?? [];
      list.push(n);
      byParent.set(parent, list);
    }
    const order = (a: SpineNode, b: SpineNode) => {
      const da = parseDate(a.startDate)?.getTime() ?? Infinity;
      const db = parseDate(b.startDate)?.getTime() ?? Infinity;
      return da !== db ? da - db : a.title.localeCompare(b.title);
    };
    for (const list of byParent.values()) list.sort(order);
    return { childrenByParent: byParent, roots: byParent.get(null) ?? [] };
  }, [data]);

  // DFS into the visible (non-collapsed) row list.
  const visible = useMemo(() => {
    const out: SpineNode[] = [];
    const walk = (node: SpineNode) => {
      out.push(node);
      if (collapsed.has(node.key)) return;
      for (const child of childrenByParent.get(node.key) ?? []) walk(child);
    };
    for (const r of roots) walk(r);
    return out;
  }, [roots, childrenByParent, collapsed]);

  const range = useMemo(() => {
    let min: Date | null = null, max: Date | null = null;
    for (const n of data?.nodes ?? []) {
      const s = parseDate(n.startDate); const e = parseDate(n.endDate) ?? s;
      const lo = s ?? e; const hi = e ?? s;
      if (lo && (!min || lo < min)) min = lo;
      if (hi && (!max || hi > max)) max = hi;
    }
    if (!min || !max) return null;
    return { start: startOfDay(new Date(min.getTime() - 3 * DAY_MS)), end: startOfDay(new Date(max.getTime() + 3 * DAY_MS)) };
  }, [data]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;
  if (!data.nodes.length) return <PmEmpty message={t('empty')} />;

  const totalDays = range ? daysBetween(range.start, range.end) + 1 : 0;
  const timelineWidth = totalDays * PX_PER_DAY;
  const segments = range ? monthSegments(range.start, range.end) : [];
  const today = startOfDay(new Date());
  const todayOffset = range ? daysBetween(range.start, today) : -1;
  const todayInRange = range != null && todayOffset >= 0 && todayOffset < totalDays;

  const toggle = (key: string) =>
    setCollapsed((s) => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const tot = data.totals;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Totals + legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{t('totalInvestment')}: {formatUsd(tot.totalUsd)}</strong>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: COST_CLASS_COLORS.capex, display: 'inline-block' }} />
          {t('capex')}: {formatUsd(tot.capexUsd)}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: COST_CLASS_COLORS.opex, display: 'inline-block' }} />
          {t('opex')}: {formatUsd(tot.opexUsd)}
        </span>
        {data.anomalyCount > 0 && (
          <span style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>⚠ {t('anomalies', { count: data.anomalyCount })}</span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{t('estimateNote')}</span>
        <button type="button" onClick={exportCsv}
          style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
          {t('exportCsv')}
        </button>
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_COL + timelineWidth }}>
            {/* Axis header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0 }}>
              <div style={{ width: NAME_COL, flexShrink: 0, padding: '8px 12px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
                {t('item')}
              </div>
              <div style={{ position: 'relative', width: timelineWidth, display: 'flex' }}>
                {segments.map((seg, i) => (
                  <div key={i} style={{ width: seg.days * PX_PER_DAY, flexShrink: 0, padding: '8px 6px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', borderLeft: i === 0 ? 'none' : '1px solid var(--border-subtle)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {seg.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div style={{ position: 'relative' }}>
              {todayInRange && (
                <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: NAME_COL + todayOffset * PX_PER_DAY, width: 2, background: 'var(--coral-bright)', opacity: 0.5, zIndex: 1 }} />
              )}
              {visible.map((node) => {
                const start = parseDate(node.startDate);
                const end = parseDate(node.endDate) ?? start;
                const hasBar = range != null && start != null && end != null;
                const offset = hasBar ? daysBetween(range!.start, start!) : 0;
                const duration = hasBar ? Math.max(1, daysBetween(start!, end!) + 1) : 0;
                const cls = node.effectiveCostClass;
                const barColor = cls ? COST_CLASS_COLORS[cls] : 'var(--text-muted)';
                const hasChildren = (childrenByParent.get(node.key)?.length ?? 0) > 0;
                const isCollapsed = collapsed.has(node.key);
                return (
                  <div key={node.key} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ width: NAME_COL, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 8, paddingLeft: 8 + node.depth * 16, overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => hasChildren && toggle(node.key)}
                        aria-label={isCollapsed ? t('expand') : t('collapse')}
                        style={{ width: 16, flexShrink: 0, background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default', color: 'var(--text-muted)', fontSize: '0.7rem', padding: 0 }}
                      >
                        {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
                      </button>
                      <span style={{ flexShrink: 0, fontSize: '0.72rem' }} title={t(`kind.${node.kind}`)}>{KIND_ICON[node.kind]}</span>
                      <span title={node.title} style={{ fontSize: '0.8rem', fontWeight: node.kind === 'task' ? 400 : 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {node.title}
                      </span>
                      {node.anomaly && <span title={t('anomalyTip')} style={{ color: 'var(--coral-bright)', flexShrink: 0 }}>⚠</span>}
                      {!node.anomaly && node.hasDescendantAnomaly && <span title={t('descendantAnomalyTip')} style={{ color: '#e0a93f', flexShrink: 0, fontSize: '0.7rem' }}>⚠</span>}
                      {node.cost.totalUsd > 0 && (
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '0.7rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatUsd(node.cost.totalUsd)}</span>
                      )}
                    </div>
                    <div style={{ position: 'relative', width: timelineWidth }}>
                      {hasBar ? (
                        <div
                          title={`${formatShort(start!)} → ${formatShort(end!)} · ${cls ? t(cls) : t('unclassified')} · ${formatUsd(node.cost.totalUsd)}`}
                          style={{ position: 'absolute', top: (ROW_H - 16) / 2, left: offset * PX_PER_DAY, width: duration * PX_PER_DAY, height: 16, background: barColor, opacity: node.kind === 'task' ? 0.75 : 0.92, borderRadius: 5, zIndex: 2, border: cls ? 'none' : '1px dashed var(--border-strong, var(--text-muted))' }}
                        />
                      ) : (
                        <div style={{ position: 'absolute', top: (ROW_H - 14) / 2, left: 6, fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('undated')}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
