/**
 * Insights cache version-key helpers — the SINGLE source of truth for the
 * per-tenant version tokens that the insights lenses fold into their cache keys.
 * A write path (tracker CRUD, connector ingest, …) bumps the matching token via
 * bumpCacheVersion so the next lens read recomputes. Lives in the application
 * layer so ingest code (boardsync) can import it without depending on the route
 * module (no application→presentation edge). insightsRoutes re-exports these.
 */

export const financeVersionKey = (tenantId: number): string => `insights-finance-version:tenant:${tenantId}`;
export const allocationVersionKey = (tenantId: number): string => `insights-allocation-version:tenant:${tenantId}`;
export const qualityVersionKey = (tenantId: number): string => `insights-quality-version:tenant:${tenantId}`;
export const peopleVersionKey = (tenantId: number): string => `insights-people-version:tenant:${tenantId}`;
export const aiProgramVersionKey = (tenantId: number): string => `insights-ai-program-version:tenant:${tenantId}`;
export const rdFinancialsVersionKey = (tenantId: number): string => `insights-rd-financials-version:tenant:${tenantId}`;
export const incidentVersionKey = (tenantId: number): string => `incidents-version:tenant:${tenantId}`;
