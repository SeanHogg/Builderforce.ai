/**
 * What the heat says, in words (PRD 33 §8 S4, `HEATMAP_INSIGHT_RULES`).
 *
 * The API decides (deterministic rules over exact counts); this renders each
 * finding's title from `replay.heatInsight.<ruleId>` over its `params`, plus
 * the actions in `HEAT_INSIGHT_ACTIONS` that apply to it — "Watch replays"
 * (the `issues` kind on the route, and the element when there is one) and,
 * for a ticket-worthy finding, "Copy link" to paste into the ticket. A finding
 * about an element that a fix has been prescribed for carries that fix (THE fix
 * card, compact — matched by the route and the element's selector).
 */

import { useTranslations } from 'next-intl';
import type { ReplayDeviceClass, ReplayHeatInsightDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { useToast } from '@/components/ToastProvider';
import { panelHref } from '@/components/insights/panelUrl';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { useFormat } from '@/i18n/useFormat';
import type { Formatter } from '@/i18n/format';
import { PrescriptionCard } from '../prescriptions/PrescriptionCard';
import { matchesPrescription } from '../prescriptions/prescriptionModel';
import { usePrescriptionsFor } from '../prescriptions/usePrescriptionsFor';
import { issuesOnRoute, routeHeatLevel } from './heatLinks';

export interface HeatmapInsightsProps {
  siteId: string;
  route: string;
  release?: string | null;
  compare?: string | null;
  device?: ReplayDeviceClass | null;
  days?: number;
  push: (level: InsightPanelLevel) => void;
}

interface ActionContext {
  push: (level: InsightPanelLevel) => void;
  copy: (href: string) => void;
}

interface HeatInsightAction {
  id: string;
  /** Under `replay.heatInsight.actions`. */
  labelKey: string;
  appliesTo: (insight: ReplayHeatInsightDto) => boolean;
  run: (insight: ReplayHeatInsightDto, ctx: ActionContext) => void;
}

/** The actions a heat finding offers, in order. Data, not branches. */
export const HEAT_INSIGHT_ACTIONS: ReadonlyArray<HeatInsightAction> = [
  {
    id: 'watch',
    labelKey: 'watch',
    appliesTo: () => true,
    run: (insight, { push }) => push(issuesOnRoute(insight.route, insight.selector)),
  },
  {
    id: 'copy',
    labelKey: 'copyLink',
    appliesTo: (insight) => insight.action === 'ticket',
    run: (insight, { copy }) => copy(panelHref(routeHeatLevel(insight.route))),
  },
];

/**
 * The values a title interpolates: the rule's own `params`, the element named
 * by its label (else its selector), and the 0..1 shares as percentages.
 */
export function insightValues(insight: ReplayHeatInsightDto, fmt: Formatter): Record<string, string | number> {
  const values: Record<string, string | number> = { ...insight.params };
  values.label = String(insight.params.label || insight.selector || insight.route);
  if (typeof insight.params.reach === 'number') values.reach = fmt.percent(insight.params.reach);
  if (typeof insight.params.decile === 'number') values.depth = insight.params.decile * 10;
  return values;
}

export function HeatmapInsights({ siteId, route, release = null, compare = null, device = null, days, push }: HeatmapInsightsProps) {
  const t = useTranslations('replay.heatInsight');
  const fmt = useFormat();
  const toast = useToast();
  const { data, loading, error } = useAdminData<ReplayHeatInsightDto[]>(
    () => replayApi.heatInsights(siteId, { route, release, compare, device, days }),
    [siteId, route, release, compare, device, days],
  );
  const fixes = usePrescriptionsFor({ siteId, route }).items;

  const ctx: ActionContext = {
    push,
    copy: (href) => {
      navigator.clipboard.writeText(href)
        .then(() => toast.success(t('copied')))
        .catch((err: unknown) => { void err; toast.error(t('copyFailed')); });
    },
  };

  return (
    <section aria-labelledby="heat-insights-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <h3 id="heat-insights-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('title')}</h3>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {error}</p>}
      {loading && !data && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {data && data.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>}
      {data && data.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {data.map((insight, index) => (
            <li
              key={`${insight.ruleId}:${insight.selector ?? ''}:${index}`}
              data-testid="heat-insight"
              data-rule={insight.ruleId}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)' }}
            >
              <p style={{ margin: 0, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{t(insight.ruleId, insightValues(insight, fmt))}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                {HEAT_INSIGHT_ACTIONS.filter((action) => action.appliesTo(insight)).map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="btn-secondary"
                    style={{ minHeight: 44 }}
                    onClick={() => action.run(insight, ctx)}
                  >
                    {t(`actions.${action.labelKey}`)}
                  </button>
                ))}
              </div>
              {insight.selector && fixes
                .filter((p) => matchesPrescription(p, { selector: insight.selector ?? undefined }))
                .map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
