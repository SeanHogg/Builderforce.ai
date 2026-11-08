/**
 * The ONE client-cached read of the tenant's assignee → personality map.
 *
 * The board's {@link AssigneeProfilesProvider}, the @-mention dropdown and the
 * person profile page all want the same `GET /api/kanban/assignee-profiles` answer;
 * routing them through one keyed cache means opening the dropdown never adds a
 * request, however many keystrokes it sees.
 */
import { kanbanApi, type AssigneeProfileMap } from '@/lib/builderforceApi';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';

const PREFIX = 'assignee-profiles:';
const TTL_MS = 5 * 60_000;

export function loadAssigneeProfileMap(tenantKey: string): Promise<AssigneeProfileMap> {
  return getOrSetClientCached(`${PREFIX}${tenantKey}`, () => kanbanApi.assigneeProfiles(), { ttlMs: TTL_MS });
}

/** Drop the cached map (a personality was just edited). */
export function clearAssigneeProfileMap(): void {
  invalidateClientCache(PREFIX);
}
