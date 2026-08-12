'use client';

/**
 * Autonomy-Health lens, decomposed into individually-PINNABLE widgets.
 *
 * The question this lens exists to answer: *are the tickets the AI manager (or a
 * human) opens actually going through their full lifecycle autonomously?* Every
 * card here reads the SAME collector through {@link useAutonomy} (one shared,
 * deduped request per window × project scope), renders only its body (the
 * WidgetCard chrome supplies frame + title + pin), and drills back into the full
 * Autonomy report. Mirrors aiImpactWidgets.tsx.
 *
 * Charting rules honoured here (see the project's dataviz conventions):
 *   • the ORIGIN funnel is small multiples — one panel per origin — because the
 *     deliverable is the manager/agent-created vs human-created COMPARISON, and
 *     five single-hue stage bars per panel keep it a magnitude read rather than a
 *     colour-matching exercise;
 *   • colour follows the ORIGIN (the entity), never its rank in the response, so
 *     filtering the window never repaints the survivors;
 *   • the hop split is the EMPHASIS form — autonomy in the brand hue, people in
 *     the de-emphasis neutral — because "what share is autonomous" is the point;
 *   • every chart has a legend (≥2 series) and the exact counts live in the
 *     table-view widget, which is what earns the low-contrast palette entries;
 *   • all series colours come from the shared CHART_PALETTE (`colorAt`), all
 *     chrome from theme tokens, so both themes work with no per-theme hex.
 */

import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import {
  autonomyApi, autonomousHopShare, shareOfCreated,
  AUTONOMY_STAGES, ORIGIN_ORDER, STAGE_FIELD,
  type AutonomyOriginStats, type AutonomyStage, type AutonomySummary, type TicketOrigin,
} from '@/lib/autonomyApi';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { StackedBar, StackedBarLegend } from '@/components/charts/StackedBar';
import { colorAt } from '@/components/charts/chartColors';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { int, pct } from '../format';

/** One shared, deduped read of the Autonomy collector per (window × project). */
function useAutonomy(days: number) {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<AutonomySummary>(
    `autonomy:${days}:${currentProjectId ?? 'all'}`,
    () => autonomyApi.get(days, currentProjectId),
  );
}

/**
 * Localized labels for the lens's two enumerations. Kept as one hook so the
 * dynamic-key casts live in exactly one place and every card/sub-panel names an
 * origin or a stage identically.
 */
function useAutonomyLabels() {
  const t = useTranslations('insights');
  return {
    t,
    originLabel: (origin: TicketOrigin): string => t(`autonomy.origin.${origin}` as never),
    stageLabel: (stage: AutonomyStage): string => t(`autonomy.stage.${stage}` as never),
  };
}
type Labels = ReturnType<typeof useAutonomyLabels>;

/** Loading / error boilerplate every card shares, plus the shared labels. */
function useAuto(days: number) {
  const labels = useAutonomyLabels();
  const source = useAutonomy(days);
  return { data: source.data, state: useSourceState(source), ...labels };
}

// ── Colour identity ───────────────────────────────────────────────────────────

/**
 * Stable hue per origin, drawn from the shared CHART_PALETTE. This exact
 * four-hue set (violet / teal / amber / blue) is the one arrangement of the
 * palette that clears all-pairs CVD separation, so it is deliberate, not
 * incidental. `unknown` intentionally takes the de-emphasis neutral: "no
 * attribution recorded" is an absence, not a fifth category worth a hue.
 */
const ORIGIN_COLOR: Record<TicketOrigin, string> = {
  agent: colorAt(0),          // violet — the brand hue: autonomy's own work
  manager_card: colorAt(5),   // teal
  human: colorAt(3),          // amber
  system: colorAt(1),         // blue
  unknown: 'var(--text-muted)',
};

/** Autonomy vs people — the emphasis pair for every hop-split visual. */
const HOP_AUTONOMOUS = colorAt(0);
const HOP_HUMAN = 'var(--text-muted)';

/** Severity hue for the stall ranking (ONE series, so no categorical collision). */
const STALL_COLOR = colorAt(4);

const DRILL: WidgetDrill = { kind: 'route', href: '/insights/autonomy' };
const CAP = 'insights.autonomy' as const;

// ── Shared bits ───────────────────────────────────────────────────────────────

/** Origins in a deterministic order (server sorts by volume; we sort by identity
 *  so the panels never reshuffle between windows), empty buckets dropped. */
function orderedOrigins(data: AutonomySummary): AutonomyOriginStats[] {
  const byOrigin = new Map(data.byOrigin.map((o) => [o.origin, o]));
  return ORIGIN_ORDER.map((o) => byOrigin.get(o)).filter((o): o is AutonomyOriginStats => o != null && o.tickets > 0);
}

/** Origin rows plus the fleet total — the total is suppressed when there is only
 *  one origin, where it would restate that row rather than summarize anything. */
function rowsWithTotals(data: AutonomySummary): Array<{ stats: AutonomyOriginStats; isTotal: boolean }> {
  const origins = orderedOrigins(data);
  const rows = origins.map((stats) => ({ stats, isTotal: false }));
  return origins.length > 1 ? [...rows, { stats: data.totals, isTotal: true }] : rows;
}

/** Small colour chip + name — the legend key reused wherever an origin is named. */
function OriginChip({ origin, label }: { origin: TicketOrigin; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: ORIGIN_COLOR[origin], flexShrink: 0 }} />
      <span style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  );
}

/**
 * Coverage / truncation notice. The server audits at most N tickets per window,
 * so when `truncated` is true these figures are a SAMPLE — say so rather than
 * implying full coverage. Exported for the lens header too.
 */
export function AutonomyCoverage({ data }: { data: AutonomySummary }) {
  const t = useTranslations('insights');
  const warn = data.truncated;
  return (
    <div
      role="note"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        fontSize: '0.78rem', lineHeight: 1.5, padding: '8px 12px', borderRadius: 'var(--radius-md)',
        border: `1px solid ${warn ? 'var(--warning)' : 'var(--border-subtle)'}`,
        background: warn ? 'var(--warning-bg, rgba(245,158,11,0.16))' : 'var(--bg-elevated)',
        color: warn ? 'var(--warning-text, var(--text-primary))' : 'var(--text-secondary)',
      }}
    >
      <span aria-hidden>{warn ? <Icon source="⚠" size="1em" /> : <Icon source="ℹ" size="1em" />}</span>
      <span>
        {warn
          ? t('autonomy.coverage.truncated', { n: int(data.ticketsScanned), days: data.windowDays })
          : t('autonomy.coverage.full', { n: int(data.ticketsScanned), days: data.windowDays })}
      </span>
    </div>
  );
}

/**
 * The truncation warning, shown INSIDE a data card. A card can be pinned onto a
 * dashboard far away from the lens header, so any card that quotes funnel figures
 * repeats the caveat rather than letting a sample read as full coverage. Renders
 * nothing when the audit was complete (the lens header already states coverage).
 */
function TruncationFlag({ data }: { data: AutonomySummary }) {
  if (!data.truncated) return null;
  return <AutonomyCoverage data={data} />;
}

// ── THE CENTREPIECE: the per-origin lifecycle funnel ──────────────────────────

/**
 * One origin's funnel: Created → Ever dispatched → Progressed autonomously →
 * Reached Done → Fully autonomous. Bars carry the SHARE of created (the only
 * figure comparable across origins of wildly different volume); the faint track
 * behind each bar is the funnel mouth, so the drop-off is visible without a
 * second axis. Exact counts live in the table-view widget.
 */
function OriginFunnel({ stats, labels }: { stats: AutonomyOriginStats; labels: Labels }) {
  const { t, originLabel, stageLabel } = labels;
  const color = ORIGIN_COLOR[stats.origin];
  const bars = AUTONOMY_STAGES.map((stage) => ({
    key: stage,
    label: stageLabel(stage),
    value: Number(stats[STAGE_FIELD[stage]]),
    secondary: stats.tickets,
    color,
  }));
  const fullyPct = shareOfCreated(stats, stats.fullyAutonomous);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <OriginChip origin={stats.origin} label={originLabel(stats.origin)} />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {t('autonomy.ticketsCreated', { n: int(stats.tickets) })}
        </span>
      </header>
      <BarChart
        data={bars}
        // 132 keeps the row's min-content (label + bar + value) at ~256px, so a
        // `md`/`lg` card still fits a 360px viewport without horizontal overflow.
        labelWidth={132}
        formatValue={(v) => pct(shareOfCreated(stats, v))}
        ariaLabel={t('autonomy.funnelAria', { origin: originLabel(stats.origin), n: int(stats.tickets) })}
      />
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{pct(fullyPct)}</strong>{' '}
        {t('autonomy.endToEnd', { n: int(stats.fullyAutonomous) })}
      </p>
    </section>
  );
}

function OriginFunnelCard({ days }: WidgetCardProps) {
  const { data, state, ...labels } = useAuto(days);
  if (!data) return state;
  const origins = orderedOrigins(data);
  if (origins.length === 0) return <Muted>{labels.t('autonomy.noTickets')}</Muted>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, alignItems: 'start' }}>
        {origins.map((o) => <OriginFunnel key={o.origin} stats={o} labels={labels} />)}
      </div>
      <TruncationFlag data={data} />
    </div>
  );
}

/** Table view of the same funnel — exact counts + the end-to-end conversion. */
function FunnelTableCard({ days }: WidgetCardProps) {
  const { data, state, t, originLabel, stageLabel } = useAuto(days);
  if (!data) return state;
  const rows = rowsWithTotals(data);
  if (rows.length === 0) return <Muted>{t('autonomy.noTickets')}</Muted>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* Wide table scrolls inside its own container (tableWrapStyle) rather than
          pushing the page sideways on a narrow viewport. */}
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadRowStyle}>
              <th style={thStyle}>{t('autonomy.origin.label')}</th>
              {AUTONOMY_STAGES.map((s) => <th key={s} style={thStyle}>{stageLabel(s)}</th>)}
              <th style={thStyle}>{t('autonomy.conversion')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ stats: o, isTotal }) => (
              <tr key={isTotal ? 'totals' : o.origin} style={trStyle}>
                <td style={{ ...tdStyle, fontWeight: isTotal ? 700 : 400 }}>
                  {isTotal ? t('autonomy.allOrigins') : <OriginChip origin={o.origin} label={originLabel(o.origin)} />}
                </td>
                {AUTONOMY_STAGES.map((s) => (
                  <td key={s} style={{ ...tdMutedStyle, fontVariantNumeric: 'tabular-nums' }}>
                    {int(Number(o[STAGE_FIELD[s]]))}
                  </td>
                ))}
                <td style={{ ...tdStyle, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {pct(shareOfCreated(o, o.fullyAutonomous))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TruncationFlag data={data} />
    </div>
  );
}

// ── Hop split: who is actually moving the board ───────────────────────────────

/**
 * Autonomous vs human lane moves, per origin plus the fleet total. This is the
 * figure that cannot be fudged — every lane move carries an actor kind — so a
 * board that only moves when a person drags a card shows up as a neutral bar.
 */
function HopSplitCard({ days }: WidgetCardProps) {
  const { data, state, t, originLabel } = useAuto(days);
  if (!data) return state;
  const rows = rowsWithTotals(data).filter((r) => r.stats.autonomousHops + r.stats.humanHops > 0);
  if (rows.length === 0) return <Muted>{t('autonomy.noHops')}</Muted>;
  const aLabel = t('autonomy.hopsAutonomous');
  const hLabel = t('autonomy.hopsHuman');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* ONE legend for the whole group — identity never rides colour alone. */}
      <StackedBarLegend
        items={[
          { key: 'auto', label: aLabel, color: HOP_AUTONOMOUS },
          { key: 'human', label: hLabel, color: HOP_HUMAN },
        ]}
      />
      {rows.map(({ stats: o, isTotal }) => {
        const share = autonomousHopShare(o);
        return (
          <div key={isTotal ? 'totals' : o.origin} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: '0.82rem' }}>
              {isTotal
                ? <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t('autonomy.allOrigins')}</span>
                : <OriginChip origin={o.origin} label={originLabel(o.origin)} />}
              <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {t('autonomy.hopsOfTotal', { share: pct(share), n: int(o.autonomousHops + o.humanHops) })}
              </span>
            </div>
            <StackedBar
              legend={false}
              segments={[
                { key: 'auto', label: aLabel, value: o.autonomousHops, color: HOP_AUTONOMOUS },
                { key: 'human', label: hLabel, value: o.humanHops, color: HOP_HUMAN, onFill: 'light' },
              ]}
              ariaLabel={t('autonomy.hopSplitAria', {
                origin: isTotal ? t('autonomy.allOrigins') : originLabel(o.origin),
                a: int(o.autonomousHops),
                h: int(o.humanHops),
              })}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Stall gates: where autonomy dies ──────────────────────────────────────────

/**
 * Stall gates ranked by the tickets each is holding. The short label reuses the
 * board's existing localized triage copy (one vocabulary for "why isn't this
 * running?" across the product); the sentence under the chart is the localized
 * long form, falling back to the server's own `text` for a gate that has no copy
 * yet — so a newly-added server gate is still explained, never blank.
 */
function StallGatesCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  const tb = useTranslations('board.triage');
  if (!data) return state;
  if (data.stallReasons.length === 0) return <Muted>{t('autonomy.noStalls')}</Muted>;

  const shortLabel = (reason: string): string =>
    tb.has(`reason.${reason}` as never) ? tb(`reason.${reason}` as never)
      : t.has(`autonomy.gateShort.${reason}` as never) ? t(`autonomy.gateShort.${reason}` as never)
        : reason;
  const longText = (reason: string, fallback: string): string =>
    t.has(`autonomy.gate.${reason}` as never) ? t(`autonomy.gate.${reason}` as never) : fallback;

  const top = data.stallReasons.slice(0, 6);
  const bars = top.map((g) => ({ key: g.reason, label: shortLabel(g.reason), value: g.tickets, color: STALL_COLOR }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <BarChart
        data={bars}
        labelWidth={132}
        formatValue={(v) => int(v)}
        ariaLabel={t('autonomy.stallAria', { n: int(data.totals.stalled) })}
      />
      <dl style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0 }}>
        {top.map((g) => (
          <div key={g.reason} style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
            <dt style={{ display: 'inline', fontWeight: 700, color: 'var(--text-primary)' }}>{shortLabel(g.reason)}</dt>
            <dd style={{ display: 'inline', margin: 0, color: 'var(--text-secondary)' }}>
              {' — '}{longText(g.reason, g.text)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Who opens the work ────────────────────────────────────────────────────────

function OriginMixCard({ days }: WidgetCardProps) {
  const { data, state, t, originLabel } = useAuto(days);
  if (!data) return state;
  const origins = orderedOrigins(data);
  if (origins.length === 0) return <Muted>{t('autonomy.noTickets')}</Muted>;
  return (
    <DonutChart
      segments={origins.map((o) => ({
        key: o.origin, label: originLabel(o.origin), value: o.tickets, color: ORIGIN_COLOR[o.origin],
      }))}
      centerValue={int(data.totals.tickets)}
      centerLabel={t('autonomy.stage.created')}
      formatValue={(v) => int(v)}
      ariaLabel={t('autonomy.originMixAria')}
    />
  );
}

// ── Headline stats ────────────────────────────────────────────────────────────

function FullyAutonomousCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  if (!data) return state;
  const s = data.totals;
  return (
    <Stat
      value={s.tickets > 0 ? pct(shareOfCreated(s, s.fullyAutonomous)) : '—'}
      sub={t('autonomy.stat.fullySub', { n: int(s.fullyAutonomous), total: int(s.tickets) })}
    />
  );
}

function DispatchRateCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  if (!data) return state;
  const s = data.totals;
  return (
    <Stat
      value={s.tickets > 0 ? pct(shareOfCreated(s, s.everDispatched)) : '—'}
      sub={t('autonomy.stat.dispatchedSub', { n: int(s.everDispatched), total: int(s.tickets) })}
    />
  );
}

function HopShareCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  if (!data) return state;
  const s = data.totals;
  const share = autonomousHopShare(s);
  return (
    <Stat
      value={share == null ? '—' : pct(share)}
      sub={t('autonomy.stat.hopShareSub', { a: int(s.autonomousHops), h: int(s.humanHops) })}
    />
  );
}

function StalledCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  if (!data) return state;
  const s = data.totals;
  return (
    <Stat value={int(s.stalled)} sub={t('autonomy.stat.stalledSub', { share: pct(shareOfCreated(s, s.stalled)) })} />
  );
}

function NeverStartedCard({ days }: WidgetCardProps) {
  const { data, state, t } = useAuto(days);
  if (!data) return state;
  const s = data.totals;
  return (
    <Stat value={int(s.neverStarted)} sub={t('autonomy.stat.neverStartedSub', { share: pct(shareOfCreated(s, s.neverStarted)) })} />
  );
}

function CoverageCard({ days }: WidgetCardProps) {
  const { data, state } = useAuto(days);
  if (!data) return state;
  return <AutonomyCoverage data={data} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const AUTONOMY_WIDGETS: WidgetDef[] = [
  { id: 'autonomy.fully-autonomous', group: 'autonomy', titleKey: 'autoFully', capability: CAP, size: 'sm', Card: FullyAutonomousCard, drill: DRILL },
  { id: 'autonomy.dispatch-rate', group: 'autonomy', titleKey: 'autoDispatched', capability: CAP, size: 'sm', Card: DispatchRateCard, drill: DRILL },
  { id: 'autonomy.hop-share', group: 'autonomy', titleKey: 'autoHopShare', capability: CAP, size: 'sm', Card: HopShareCard, drill: DRILL },
  { id: 'autonomy.stalled', group: 'autonomy', titleKey: 'autoStalled', capability: CAP, size: 'sm', Card: StalledCard, drill: DRILL },
  { id: 'autonomy.never-started', group: 'autonomy', titleKey: 'autoNeverStarted', capability: CAP, size: 'sm', Card: NeverStartedCard, drill: DRILL },
  { id: 'autonomy.origin-funnel', group: 'autonomy', titleKey: 'autoOriginFunnel', capability: CAP, size: 'lg', Card: OriginFunnelCard, drill: DRILL },
  { id: 'autonomy.hop-split', group: 'autonomy', titleKey: 'autoHopSplit', capability: CAP, size: 'md', Card: HopSplitCard, drill: DRILL },
  { id: 'autonomy.stall-gates', group: 'autonomy', titleKey: 'autoStallGates', capability: CAP, size: 'md', Card: StallGatesCard, drill: DRILL },
  { id: 'autonomy.origin-mix', group: 'autonomy', titleKey: 'autoOriginMix', capability: CAP, size: 'md', Card: OriginMixCard, drill: DRILL },
  { id: 'autonomy.funnel-table', group: 'autonomy', titleKey: 'autoFunnelTable', capability: CAP, size: 'lg', Card: FunnelTableCard, drill: DRILL },
  { id: 'autonomy.coverage', group: 'autonomy', titleKey: 'autoCoverage', capability: CAP, size: 'md', Card: CoverageCard, drill: DRILL },
];

/** Ids in the order the full lens lays them out. */
export const AUTONOMY_WIDGET_IDS = AUTONOMY_WIDGETS.map((w) => w.id);

/** Re-exported so the lens header can reuse the SAME deduped read (no extra request). */
export { useAutonomy };
