/**
 * The period-bounded CapEx/OpEx finance export — `GET /api/pmo/spine/export.csv`.
 *
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` bounds the LLM + logged-time cost; `?project=`
 * scopes. One row per planning-spine node plus a TOTAL row, straight off the same
 * `loadPlanningSpine` the spine view renders, so the file cannot disagree with it.
 *
 * The route used to build this CSV with its own `esc` closure that quoted only
 * the title column; it is a table now, serialised by the one export renderer.
 */
import { TenantRole } from '../../domain/shared/types';
import { positiveIntParam } from '../../domain/shared/boundedInt';
import type { ExportTable, TenantExportSource } from '../export/exportSource';
import { loadPlanningSpine, type SpineResult } from './planningSpine';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const usd = (n: number) => n.toFixed(2);


/** The spine's cost roll-up as a table: every node, then the TOTAL row. */
export function capexOpexTable(spine: SpineResult): ExportTable {
  const t = spine.totals;
  return {
    columns: ['kind', 'id', 'title', 'effective_cost_class', 'llm_usd', 'human_usd', 'total_usd', 'capex_usd', 'opex_usd'],
    rows: [
      ...spine.nodes.map((n) => [
        n.kind, n.id, n.title, n.effectiveCostClass ?? '',
        usd(n.cost.llmUsd), usd(n.cost.humanUsd), usd(n.cost.totalUsd), usd(n.cost.capexUsd), usd(n.cost.opexUsd),
      ]),
      ['TOTAL', '', '', '', usd(t.llmUsd), usd(t.humanUsd), usd(t.totalUsd), usd(t.capexUsd), usd(t.opexUsd)],
    ],
  };
}

/** Any workspace member may pull it — the spine view it mirrors is ungated too. */
export const capexOpexExportSource: TenantExportSource = {
  id: 'pmo.capex-opex',
  label: 'CapEx / OpEx finance export',
  scope: 'tenant',
  minRole: TenantRole.VIEWER,
  formats: ['csv', 'xlsx', 'json'],
  async load(ctx) {
    const from = ctx.param('from');
    const to = ctx.param('to');
    const window = from && to && ISO_DAY.test(from) && ISO_DAY.test(to) ? { from, to } : undefined;
    const projectId = positiveIntParam(ctx.param('project'));
    const spine = await loadPlanningSpine(ctx.db, ctx.tenantId, ctx.segmentId, { projectId, window });
    return {
      filename: `capex-opex-${window ? `${window.from}_${window.to}` : 'all'}`,
      title: 'CapEx / OpEx',
      table: capexOpexTable(spine),
    };
  },
};
