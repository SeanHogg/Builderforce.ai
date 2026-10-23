import { useTranslations } from 'next-intl';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { StackedBar } from '@/components/charts/StackedBar';
import { colorAt } from '@/components/charts/chartColors';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { KpiGrid } from '@/components/insights/LensShell';
import { useInsightFormat } from '@/components/insights/format';
import { useRunCostBreakdown } from '@/components/insights/cost/costSources';
import { useCostMetricFormat } from '@/components/insights/cost/costMetricFormat';
import {
  budgetUsage, uncachedTokens, type RunBudget, type RunCostBreakdown, type RunTurnBreakdown, type TurnContextCategories,
} from '@/lib/costMetricsApi';

/** The token split, in the order it is drawn and tabled. Colour follows the PART, never its rank. */
export const TOKEN_PARTS = ['uncached', 'cacheRead', 'cacheWrite', 'output', 'reasoning'] as const;
export type TokenPart = (typeof TOKEN_PARTS)[number];
/** i18n key (under `insights.cost`) per token part. */
export const TOKEN_PART_LABEL_KEY: Record<TokenPart, string> = {
  uncached: 'run.part.uncached',
  cacheRead: 'run.part.cacheRead',
  cacheWrite: 'run.part.cacheWrite',
  output: 'run.part.output',
  reasoning: 'run.part.reasoning',
};

/** The estimated context split, in drawing order. */
export const CONTEXT_CATEGORIES = ['system', 'tools', 'history', 'toolOutputs', 'memory'] as const satisfies ReadonlyArray<keyof TurnContextCategories>;
/** i18n key (under `insights.cost`) per context category. */
export const CONTEXT_CATEGORY_LABEL_KEY: Record<(typeof CONTEXT_CATEGORIES)[number], string> = {
  system: 'run.category.system',
  tools: 'run.category.tools',
  history: 'run.category.history',
  toolOutputs: 'run.category.toolOutputs',
  memory: 'run.category.memory',
};

/** i18n key (under `insights.cost`) naming where a run's cap came from. */
export const BUDGET_SOURCE_LABEL_KEY: Record<RunBudget['source'], string> = {
  payload: 'run.budgetSource.payload',
  plan: 'run.budgetSource.plan',
  default: 'run.budgetSource.default',
};

/** Used-vs-cap meter for a StatCard: fills to the share used, turns `--danger` past the cap. */
function BudgetMeter({ share, label }: { share: number; label: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      style={{ height: 6, width: '100%', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', overflow: 'hidden' }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: share > 1 ? 'var(--danger)' : share >= 0.8 ? 'var(--warning)' : 'var(--accent)' }} />
    </div>
  );
}

function partsOf(t: RunTurnBreakdown['tokens']): Record<TokenPart, number | null> {
  return {
    uncached: uncachedTokens(t),
    cacheRead: t.cacheRead,
    cacheWrite: t.cacheCreation,
    // Output excluding reasoning, so the parts add up to what was billed.
    output: Math.max(0, t.completion - (t.reasoning ?? 0)),
    reasoning: t.reasoning,
  };
}

/**
 * One run's cost, turn by turn: the model each turn used, where its tokens went
 * (uncached / cache read / cache write / output / reasoning), the tool-schema
 * overhead it carried, and what it cost — with the totals on top so the reader sees
 * the verdict before the records. Estimates (tool schemas, context split) carry "≈".
 */
export function RunCostBreakdownView({ executionId }: { executionId: number }) {
  const tc = useTranslations('common');
  const t = useTranslations('insights.cost');
  const { data, error } = useRunCostBreakdown(executionId);
  if (error) return <PmError message={t('loadFailed')} />;
  if (!data) return <PmEmpty message={tc('loading')} />;
  if (data.turns.length === 0) return <PmEmpty message={t('run.empty')} />;
  return <RunCostBreakdownBody data={data} />;
}

function RunCostBreakdownBody({ data }: { data: RunCostBreakdown }) {
  const { int, compactTokens } = useInsightFormat();
  const f = useCostMetricFormat();
  const t = useTranslations('insights.cost');
  const { totals } = data;
  const partLabel = (p: TokenPart) => t(TOKEN_PART_LABEL_KEY[p] as never);

  const totalParts = partsOf({
    prompt: totals.promptTokens, completion: totals.completionTokens,
    cacheRead: totals.cacheReadTokens, cacheCreation: totals.cacheCreationTokens, reasoning: totals.reasoningTokens,
  });
  const toolSchemaTotal = data.turns.reduce<number | null>(
    (sum, turn) => (turn.toolSchemaTokens == null ? sum : (sum ?? 0) + turn.toolSchemaTokens), null,
  );
  const categoryTotals = CONTEXT_CATEGORIES.map((c, i) => ({
    key: c,
    label: t(CONTEXT_CATEGORY_LABEL_KEY[c] as never),
    value: data.turns.reduce((sum, turn) => sum + (turn.categories?.[c] ?? 0), 0),
    color: colorAt(i),
  }));
  const hasCategories = categoryTotals.some((s) => s.value > 0);
  const approxTokens = (n: number | null) => (n == null ? compactTokens(n) : t('approx', { value: compactTokens(n) }));
  const budget = data.budget ?? null;
  const usage = budgetUsage(totals, budget);
  const budgetSource = budget ? t(BUDGET_SOURCE_LABEL_KEY[budget.source] as never) : '';
  const usedTokens = totals.promptTokens + totals.completionTokens;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      {data.outcome && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
          {t(data.outcome.merged ? 'run.outcomeMerged' : 'run.outcome', {
            status: data.outcome.terminalStatus, steps: int(data.outcome.steps), action: data.outcome.actionType,
          })}
        </p>
      )}

      <KpiGrid>
        <StatCard
          label={t('run.budgetUsed')}
          value={f.approxUsd(totals.costUsd)}
          sub={budget && usage.usd != null
            ? t('run.budgetOfCap', { share: f.ratioPct(usage.usd), cap: f.approxUsd(budget.capUsd), source: budgetSource })
            : t('run.noCap')}
          chart={usage.usd != null ? <BudgetMeter share={usage.usd} label={t('run.budgetUsed')} /> : undefined}
        />
        {budget && usage.tokens != null && (
          <StatCard
            label={t('run.tokenBudget')}
            value={compactTokens(usedTokens)}
            sub={t('run.budgetOfCap', { share: f.ratioPct(usage.tokens), cap: compactTokens(budget.capTokens), source: budgetSource })}
            chart={<BudgetMeter share={usage.tokens} label={t('run.tokenBudget')} />}
          />
        )}
        <StatCard label={t('run.turns')} value={int(totals.turns)} sub={t('run.turnsSub', { models: int(new Set(data.turns.map((x) => x.model)).size) })} />
        <StatCard label={f.label('cacheHitRate')} value={f.value('cacheHitRate', totals.cacheHitRate)} sub={t('kpi.cacheHitRateSub')} />
        <StatCard label={t('run.toolSchema')} value={approxTokens(toolSchemaTotal)} sub={t('run.toolSchemaSub')} />
      </KpiGrid>

      <section aria-labelledby="run-cost-split" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 id="run-cost-split" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 700 }}>{t('run.splitTitle')}</h3>
        <StackedBar
          legend
          ariaLabel={t('run.splitTitle')}
          formatValue={(v) => compactTokens(v)}
          segments={TOKEN_PARTS.map((p, i) => ({ key: p, label: partLabel(p), value: totalParts[p] ?? 0, color: colorAt(i) }))}
        />
      </section>

      {hasCategories && (
        <section aria-labelledby="run-cost-context" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 id="run-cost-context" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 700 }}>{t('run.contextTitle')}</h3>
          <StackedBar legend ariaLabel={t('run.contextTitle')} formatValue={(v) => t('approx', { value: compactTokens(v) })} segments={categoryTotals} />
        </section>
      )}

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadRowStyle}>
              <th style={thStyle}>{t('run.colTurn')}</th>
              <th style={thStyle}>{t('run.colModel')}</th>
              {TOKEN_PARTS.map((p) => <th key={p} style={thStyle}>{partLabel(p)}</th>)}
              <th style={thStyle}>{t('run.toolSchema')}</th>
              <th style={thStyle}>{t('col.spend')}</th>
            </tr>
          </thead>
          <tbody>
            {data.turns.map((turn, i) => {
              const parts = partsOf(turn.tokens);
              return (
                <tr key={`${turn.at}:${i}`} style={trStyle}>
                  <td style={tdMutedStyle}>
                    {turn.calls > 1 ? t('run.turnMerged', { n: (turn.turnIndex ?? i) + 1, calls: int(turn.calls) }) : int((turn.turnIndex ?? i) + 1)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                    {turn.model}
                    {turn.byo && <span style={{ marginLeft: 6, fontFamily: 'inherit', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('run.byo')}</span>}
                  </td>
                  {TOKEN_PARTS.map((p) => <td key={p} style={tdMutedStyle}>{compactTokens(parts[p])}</td>)}
                  <td style={tdMutedStyle}>{approxTokens(turn.toolSchemaTokens)}</td>
                  <td style={tdStyle}>{f.approxUsd(turn.costUsd)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ ...theadRowStyle, borderTop: '1px solid var(--border-subtle)' }}>
              <th scope="row" colSpan={2} style={thStyle}>{t('run.total')}</th>
              {TOKEN_PARTS.map((p) => <td key={p} style={{ ...tdStyle, fontWeight: 600 }}>{compactTokens(totalParts[p])}</td>)}
              <td style={{ ...tdStyle, fontWeight: 600 }}>{approxTokens(toolSchemaTotal)}</td>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{f.approxUsd(totals.costUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.truncated && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('run.truncated', { n: int(data.turns.length) })}</p>
      )}
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('run.estimateNote')}</p>
    </div>
  );
}
