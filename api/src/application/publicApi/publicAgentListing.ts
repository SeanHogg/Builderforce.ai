/**
 * The developer API's view of the public agent directory (`/api/v1/agents`).
 *
 * Pure: it pages and filters the cached public listing from
 * `workforce/agentDirectory` rather than running a second query, so the API can
 * never list an agent the marketplace page does not (or the reverse).
 *
 * Each row is the marketplace's public projection plus the keys the original
 * endpoint returned (`type`, `isActive`, `createdAt`, `updatedAt`), so an existing
 * embed keeps rendering. The ids are now marketplace agent ids — the old ids named
 * rows in the legacy per-tenant registry and were never "published" agents.
 */
import { mapPublicAgentRow, type AgentRow } from '../workforce/agentDirectory';

export interface PublicAgentPageQuery {
  q?: string;
  skill?: string;
  page?: string | number;
  limit?: string | number;
}

export function toPublicApiAgent(row: AgentRow): Record<string, unknown> {
  const view = mapPublicAgentRow(row);
  return {
    ...view,
    type: 'workforce',
    isActive: true,
    createdAt: view.created_at,
    updatedAt: view.updated_at,
  };
}

const lower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

/** Filter by keyword (name / title / bio) and skill, then page. */
export function pagePublicAgents(
  rows: readonly AgentRow[],
  query: PublicAgentPageQuery,
): { agents: Record<string, unknown>[]; total: number; page: number; limit: number } {
  const pageNum = Math.max(1, Number(query.page ?? 1) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(query.limit ?? 24) || 24));
  const q = query.q?.trim().toLowerCase();
  const skill = query.skill?.trim().toLowerCase();

  const matched = rows.map(toPublicApiAgent).filter((a) => {
    if (q && ![a.name, a.title, a.bio].some((f) => lower(f).includes(q))) return false;
    if (skill && !(a.skills as unknown[]).some((s) => lower(s) === skill)) return false;
    return true;
  });

  const start = (pageNum - 1) * limitNum;
  return { agents: matched.slice(start, start + limitNum), total: matched.length, page: pageNum, limit: limitNum };
}
