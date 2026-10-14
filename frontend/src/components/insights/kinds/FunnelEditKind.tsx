/**
 * The `funnel_edit` panel kind (PRD 33 D16): creating or editing a funnel is a
 * LEVEL of the ONE Insights panel, stacked over the `funnel` level it came from
 * with a breadcrumb back — never a second overlay. The level id is the funnel
 * level's own address (`funnelLevelId`): `funnel=<id>` edits that funnel, an
 * empty id creates one.
 *
 * Save and delete return to the funnel level beneath (opened on the saved
 * funnel); Cancel pops back to it unchanged.
 */

import { useTranslations } from 'next-intl';
import type { ReplayFunnelDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { FunnelEditor } from '@/components/replay/funnels/FunnelEditor';
import { funnelLevelId, parseFunnelLevelId } from '@/components/replay/funnels/funnelLevel';
import { useInsightsScope } from '../insightsScope';
import type { InsightPanelKindProps, InsightPanelLevel } from '../panelKinds';
import { usePanel } from '../usePanel';
import { PanelPending } from './PanelPending';

export function FunnelEditKind({ siteId, id }: InsightPanelKindProps) {
  const t = useTranslations('replay.funnels');
  const { days } = useInsightsScope();
  const { levels, pop, replace } = usePanel();
  const funnelId = parseFunnelLevelId(id).funnelId ?? null;
  const { data, loading, error } = useAdminData<ReplayFunnelDto | null>(
    () => (funnelId ? replayApi.getFunnel(siteId, funnelId) : Promise.resolve(null)),
    [siteId, funnelId],
  );
  if (funnelId && !data) return <PanelPending loading={loading} error={error} />;

  /** Back to the funnel level beneath, opened on `nextFunnelId` (or the first funnel). */
  const backTo = (nextFunnelId: string | null) => {
    const below = levels.slice(0, -1);
    const funnelLevel: InsightPanelLevel = { kind: 'funnel', id: funnelLevelId(nextFunnelId ? { funnelId: nextFunnelId } : {}), tab: 'steps' };
    const last = below[below.length - 1];
    replace(last?.kind === 'funnel' ? [...below.slice(0, -1), funnelLevel] : [...below, funnelLevel]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{data ? t('editTitle') : t('newTitle')}</h3>
      <FunnelEditor
        key={data?.id ?? 'new'}
        siteId={siteId}
        days={days}
        funnel={data}
        onClose={() => pop()}
        onSaved={(saved) => backTo(saved.id)}
        onDeleted={() => backTo(null)}
      />
    </div>
  );
}
