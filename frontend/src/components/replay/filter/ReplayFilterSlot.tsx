/**
 * The header's query bar (PRD 33 §4.1, registered in `HEADER_SLOTS`): the ONE
 * filter from the Insights scope, its value suggestions from
 * `replayApi.filterOptions`, and the saved segments beside it. Every band and
 * panel kind reads the same filter from the scope, so changing it here
 * refetches them all.
 */

import { useInsightsScope } from '@/components/insights/insightsScope';
import { useAdminData } from '@/components/admin/adminShared';
import { replayApi } from '@/lib/replayApi';
import { ReplayFilterBar } from './ReplayFilterBar';
import { SegmentMenu } from './SegmentMenu';

export function ReplayFilterSlot() {
  const { siteId, days, filter, setFilter } = useInsightsScope();
  const { data: options } = useAdminData(() => replayApi.filterOptions(siteId, { days }), [siteId, days]);
  return (
    <ReplayFilterBar
      filter={filter}
      onChange={setFilter}
      options={options ?? []}
      trailing={<SegmentMenu siteId={siteId} filter={filter} onApply={setFilter} />}
    />
  );
}
