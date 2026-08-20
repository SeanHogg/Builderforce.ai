'use client';

/**
 * "Conversations vs Executions" — the chat MODE lens, as pinnable widgets.
 *
 * The question: of everything people start here, how much is a CONVERSATION and how
 * much is WORK actually handed over — and of the work handed over, how much of it a
 * machine actually picked up. Migration 0409 added the dimension that makes this
 * answerable; these cards are the read.
 *
 * The load-bearing card is the EXECUTION RATE. Counting how many Work conversations
 * were started measures intent, not delivery: a Work conversation that opens tickets
 * nothing ever runs looks identical to a productive one until you divide dispatched
 * by linked. That ratio is the one number that says whether the mode is doing its job.
 *
 * Charting rules honoured here (see the project's dataviz conventions):
 *   • colour follows the MODE (the entity), never its rank in the response, so a
 *     window change never repaints the survivors;
 *   • the cost split is the EMPHASIS form — one hue per mode against the shared
 *     total — because "what share of spend is execution" is the point;
 *   • every multi-series chart carries a legend, and exact counts live in the table
 *     card, which is what earns the low-contrast palette entries;
 *   • all series colours come from the shared CHART_PALETTE (`colorAt`) and all
 *     chrome from theme tokens, so both light and dark work with no per-theme hex.
 */

import { useTranslations } from 'next-intl';
import {
  chatModeApi, rowFor, executionRate, costShare, MODE_ORDER,
  type ChatModeUsage, type ChatModeUsageRow,
} from '@/lib/chatModeApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { BarChart } from '@/components/charts/BarChart';
import { StackedBar } from '@/components/charts/StackedBar';
import { colorAt } from '@/components/charts/chartColors';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { pct } from '../format';
import { useInsightFormat, type InsightFormatters } from '../format';

const CAP = 'insights.llmUsage' as const;
const DRILL: WidgetDrill = { kind: 'route', href: '/insights/chat-modes' };

/** One shared, deduped read per window — every card below reads this, not its own. */
function useChatModes(days: number) {
  return useSharedSource<ChatModeUsage>(`chatmodes:${days}`, () => chatModeApi.get(days));
}

/** Colour identity per mode, fixed by MODE_ORDER so it never follows response rank. */
const modeColor = (mode: string): string => colorAt(Math.max(0, MODE_ORDER.indexOf(mode as never)));

function useModeLabels() {
  const t = useTranslations('insights');
  return {
    t,
    modeLabel: (mode: string): string => t(`chatModes.mode.${mode}` as never),
  };
}

/** USD from the millicents the ledger stamps at write time. */
const usdFromMillicents = (f: InsightFormatters, v: number): string => f.usd(v / 100_000);

/** The share of started conversations that were handed over as work. */
function WorkShareCard({ days }: WidgetCardProps) {
  const { int } = useInsightFormat();
  const { t, modeLabel } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const total = data.rows.reduce((sum, r) => sum + r.conversations, 0);
  const work = rowFor(data, 'work').conversations;
  return (
    <Stat
      value={total > 0 ? pct((work / total) * 100) : '—'}
      sub={t('chatModes.workShareSub', { work: int(work), total: int(total), mode: modeLabel('work') })}
    />
  );
}

/**
 * THE card. Of the work items Work-mode conversations opened, what share ever had a
 * run dispatched. A low number here is the failure the mode split exists to surface.
 */
function ExecutionRateCard({ days }: WidgetCardProps) {
  const { int } = useInsightFormat();
  const { t } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const row = rowFor(data, 'work');
  const rate = executionRate(row);
  return (
    <Stat
      value={rate == null ? '—' : pct(rate * 100)}
      sub={rate == null
        ? t('chatModes.noWorkLinked')
        : t('chatModes.executionRateSub', { dispatched: int(row.ticketsDispatched), linked: int(row.ticketsLinked) })}
    />
  );
}

/** What execution costs relative to conversation — the operating fact. */
function CostShareCard({ days }: WidgetCardProps) {
  const insight = useInsightFormat();
  const { t, modeLabel } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const share = costShare(data, 'work');
  return (
    <Stat
      value={share == null ? '—' : pct(share * 100)}
      sub={t('chatModes.costShareSub', {
        cost: usdFromMillicents(insight, rowFor(data, 'work').costUsdMillicents),
        mode: modeLabel('work'),
      })}
    />
  );
}

/** Conversations started, per mode. The volume read the two ratios sit on top of. */
function ModeMixCard({ days }: WidgetCardProps) {
  const { int } = useInsightFormat();
  const { t, modeLabel } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const segments = MODE_ORDER.map((mode) => ({
    key: mode,
    label: modeLabel(mode),
    value: rowFor(data, mode).conversations,
    color: modeColor(mode),
  }));
  if (segments.every((s) => s.value === 0)) return <Muted>{t('chatModes.empty')}</Muted>;
  return <StackedBar segments={segments} legend formatValue={(v) => int(v)} ariaLabel={t('chatModes.mixAria')} />;
}

/**
 * Linked vs dispatched per mode — the funnel behind the execution rate. `secondary`
 * draws the linked total as a faint track so the shortfall is the visible quantity
 * rather than something the reader has to subtract.
 */
function DispatchFunnelCard({ days }: WidgetCardProps) {
  const { int } = useInsightFormat();
  const { t, modeLabel } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  const bars = MODE_ORDER.map((mode) => {
    const row = rowFor(data, mode);
    return {
      key: mode,
      label: modeLabel(mode),
      value: row.ticketsDispatched,
      secondary: row.ticketsLinked,
      color: modeColor(mode),
    };
  });
  if (bars.every((b) => b.secondary === 0)) return <Muted>{t('chatModes.noTickets')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => int(v)} ariaLabel={t('chatModes.funnelAria')} />;
}

/** The exact figures — what earns the low-contrast palette entries above. */
function ModeTableCard({ days }: WidgetCardProps) {
    const insight = useInsightFormat();
  const { int } = useInsightFormat();
  const { t, modeLabel } = useModeLabels();
  const { data, error } = useChatModes(days);
  if (error) return <Muted>{t('chatModes.loadFailed')}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.rows.length === 0) return <Muted>{t('chatModes.empty')}</Muted>;
  const cell = (row: ChatModeUsageRow) => {
    const rate = executionRate(row);
    return (
      <tr key={row.mode} style={trStyle}>
        <td style={tdStyle}>{modeLabel(row.mode)}</td>
        <td style={tdStyle}>{int(row.conversations)}</td>
        <td style={tdMutedStyle}>{int(row.engaged)}</td>
        <td style={tdStyle}>{int(row.ticketsLinked)}</td>
        <td style={tdStyle}>{int(row.ticketsDispatched)}</td>
        <td style={tdStyle}>{rate == null ? '—' : pct(rate * 100)}</td>
        <td style={tdMutedStyle}>{usdFromMillicents(insight, row.costUsdMillicents)}</td>
      </tr>
    );
  };
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>{t('chatModes.colMode')}</th>
            <th style={thStyle}>{t('chatModes.colConversations')}</th>
            <th style={thStyle}>{t('chatModes.colEngaged')}</th>
            <th style={thStyle}>{t('chatModes.colLinked')}</th>
            <th style={thStyle}>{t('chatModes.colDispatched')}</th>
            <th style={thStyle}>{t('chatModes.colExecutionRate')}</th>
            <th style={thStyle}>{t('chatModes.colCost')}</th>
          </tr>
        </thead>
        <tbody>{MODE_ORDER.map((m) => cell(rowFor(data, m)))}</tbody>
      </table>
    </div>
  );
}

export const CHAT_MODE_WIDGETS: WidgetDef[] = [
  { id: 'chatmode.work-share', group: 'chatModes', titleKey: 'chatModeWorkShare', descKey: 'chatModeWorkShare', capability: CAP, size: 'sm', Card: WorkShareCard, drill: DRILL },
  { id: 'chatmode.execution-rate', group: 'chatModes', titleKey: 'chatModeExecutionRate', descKey: 'chatModeExecutionRate', capability: CAP, size: 'sm', Card: ExecutionRateCard, drill: DRILL },
  { id: 'chatmode.cost-share', group: 'chatModes', titleKey: 'chatModeCostShare', descKey: 'chatModeCostShare', capability: CAP, size: 'sm', Card: CostShareCard, drill: DRILL },
  { id: 'chatmode.mix', group: 'chatModes', titleKey: 'chatModeMix', capability: CAP, size: 'md', Card: ModeMixCard, drill: DRILL },
  { id: 'chatmode.dispatch-funnel', group: 'chatModes', titleKey: 'chatModeFunnel', capability: CAP, size: 'md', Card: DispatchFunnelCard, drill: DRILL },
  { id: 'chatmode.table', group: 'chatModes', titleKey: 'chatModeTable', capability: CAP, size: 'lg', Card: ModeTableCard, drill: DRILL },
];

/** Ids in the order the full lens lays them out. */
export const CHAT_MODE_WIDGET_IDS = CHAT_MODE_WIDGETS.map((w) => w.id);

export { useChatModes };
