/**
 * The Insights read/write API contract (PRD 33 §3, §4).
 *
 * ONE set of DTOs shared by the API routes (which produce them) and
 * `frontend/src/lib/replayApi.ts` (which consumes them), so the two sides
 * cannot drift. Types only plus the path table; no runtime dependencies.
 *
 * Scope (D17) is always `{ tenantId, siteId }`. The tenant comes from the
 * caller's membership; the site is the `site` query parameter and must
 * belong to that tenant (403 otherwise). A project's hosted site is
 * resolved once through `REPLAY_PATHS.projectSite` and then read like any
 * other site.
 */

export * from './api/core';
export * from './api/heat';
export * from './api/analysis';
export * from './api/prescriptions';
export * from './api/paths';
