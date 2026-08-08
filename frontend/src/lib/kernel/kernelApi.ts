/**
 * THE kernel client — `/api/objects/*` and `/api/<domain>/*` (PRD 20 §6.3, §7.1).
 *
 * "Every one of those kernel routes exists today between six and forty times
 * under different names." This is the one client that replaces them, and the
 * reason the UI dedupe is downstream of the schema dedupe: a single timeline
 * component, a single comment thread and a single share sheet are only possible
 * once there is a single shape to render.
 *
 * Goes through `apiRequest`, which is THE transport — the header contract
 * (emulation token, locale, error dispatch) is load-bearing and duplicating a
 * fetch wrapper is how three of those headers silently stopped being sent.
 */

import { apiRequest } from '@/lib/apiClient';

/** The fifteen seats. Mirrors `DOMAINS` in the api's ObjectRegistry — §7 says
 *  the fifteen domains and the fifteen seats are the same list and neither may
 *  drift, so the api serves it at `/api/roster/manifest` and this literal is the
 *  compile-time half of the same list. `rosterManifest()` is the runtime check. */
export const DOMAINS = [
  'growth', 'delivery', 'agents', 'hiring', 'finance', 'revenue', 'commerce',
  'identity', 'people', 'platform', 'governance', 'investor', 'support',
  'canvas', 'integrations',
] as const;
export type Domain = (typeof DOMAINS)[number];

export function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

export const OBJECT_RELATIONS = ['activity', 'annotations', 'members', 'shares', 'revisions'] as const;
export type ObjectRelation = (typeof OBJECT_RELATIONS)[number];

export interface ObjectRef {
  id: string;
  tenantId: number | null;
  kind: string;
  refId: string;
  domain: Domain | string;
  title: string | null;
  parentId: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

export interface DomainManifestEntry {
  domain: Domain;
  seat: string;
  rootKind: string;
  kinds: string[];
  metrics: string[];
  /** Rung at which this seat's scope chips are earned. The seat itself is always
   *  listed — progressive disclosure gates STATE, never capability (§7). */
  rung: number;
}

export interface DomainSummary extends Pick<DomainManifestEntry, 'domain' | 'seat' | 'rootKind' | 'rung'> {
  itemCount: number;
  recentEventCount: number;
  lastActivityAt: string | null;
}

export interface ActivityEntry {
  id: number;
  verb: string;
  actorType: string;
  actorName: string | null;
  targetLabel: string | null;
  summary: string | null;
  occurredAt: string;
  objectId: string | null;
  objectKind?: string;
  objectTitle?: string | null;
}

export interface Annotation {
  id: number;
  objectId: string;
  parentId: number | null;
  kind: string;
  authorKind: string;
  authorRef: string | null;
  authorName: string | null;
  body: string | null;
  value: string | null;
  label: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Membership {
  id: number;
  objectId: string;
  memberKind: string;
  memberRef: string;
  role: string;
  state: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
}

export interface ShareLink {
  id: string;
  scope: 'view' | 'comment' | 'edit';
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Revision {
  id: number;
  version: number;
  label: string | null;
  authorRef: string | null;
  summary: string | null;
  byteSize: number | null;
  createdAt: string;
}

export interface MetricSeries {
  metric: string;
  unit: string | null;
  points: { at: string; value: number }[];
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
};

// ── the registry ───────────────────────────────────────────────────────────

/** Resolve any addressable thing. ONE detail route, one breadcrumb (§7.1). */
export const getObject = (id: string) => apiRequest<ObjectRef>(`/api/objects/${id}`);

/** Breadcrumb, root first. */
export const getObjectTrail = (id: string) => apiRequest<ObjectRef[]>(`/api/objects/${id}/trail`);

/** "What did I touch" — derived from `objects` + `activity_log`, never a stored
 *  list (§7). One query, where a per-feature recents would need a union across
 *  thirty tables and would silently miss the thirty-first. */
export const getRecents = (opts: { domain?: Domain; limit?: number } = {}) =>
  apiRequest<ObjectRef[]>(`/api/objects/recents${qs(opts)}`);

// ── the five relations ─────────────────────────────────────────────────────

export const getObjectActivity = (id: string, limit?: number) =>
  apiRequest<ActivityEntry[]>(`/api/objects/${id}/activity${qs({ limit })}`);

export const getObjectAnnotations = (id: string, opts: { kind?: string; limit?: number } = {}) =>
  apiRequest<Annotation[]>(`/api/objects/${id}/annotations${qs(opts)}`);

export const addObjectAnnotation = (
  id: string,
  body: { kind?: string; body?: string; value?: string; label?: string; parentId?: number },
) => apiRequest<Annotation>(`/api/objects/${id}/annotations`, { method: 'POST', body: JSON.stringify(body) });

export const getObjectMembers = (id: string, limit?: number) =>
  apiRequest<Membership[]>(`/api/objects/${id}/members${qs({ limit })}`);

export const addObjectMember = (id: string, body: { memberKind?: string; memberRef: string; role?: string }) =>
  apiRequest<Membership>(`/api/objects/${id}/members`, { method: 'POST', body: JSON.stringify(body) });

export const removeObjectMember = (id: string, kind: string, ref: string) =>
  apiRequest<void>(`/api/objects/${id}/members/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`, {
    method: 'DELETE',
  });

export const getObjectShares = (id: string) => apiRequest<ShareLink[]>(`/api/objects/${id}/shares`);

/** Returns the raw token EXACTLY once — it is never stored, only its hash. */
export const createObjectShare = (
  id: string,
  body: { scope?: ShareLink['scope']; expiresAt?: string; maxUses?: number },
) => apiRequest<{ id: string; token: string }>(`/api/objects/${id}/shares`, {
  method: 'POST',
  body: JSON.stringify(body),
});

/** THE revocation path. There are three independent API-key revocation paths in
 *  the platform today; each is a place a revoked token keeps working because
 *  somebody fixed only the other two. */
export const revokeObjectShare = (id: string, shareId: string) =>
  apiRequest<void>(`/api/objects/${id}/shares/${shareId}`, { method: 'DELETE' });

export const getObjectRevisions = (id: string, limit?: number) =>
  apiRequest<Revision[]>(`/api/objects/${id}/revisions${qs({ limit })}`);

// ── the roster ─────────────────────────────────────────────────────────────

/** Every seat's summary in ONE read. The team panel renders all fifteen at once,
 *  so fifteen calls per navigation render would be the fan-out the platform
 *  rejects outright. */
export const getRoster = () => apiRequest<DomainSummary[]>('/api/roster');

export const getRosterManifest = () => apiRequest<DomainManifestEntry[]>('/api/roster/manifest');

export const getDomainSummary = (domain: Domain) => apiRequest<DomainSummary>(`/api/${domain}/summary`);

export const getDomainItems = (domain: Domain, opts: { kind?: string; limit?: number } = {}) =>
  apiRequest<ObjectRef[]>(`/api/${domain}/items${qs(opts)}`);

export const getDomainActivity = (domain: Domain, limit?: number) =>
  apiRequest<ActivityEntry[]>(`/api/${domain}/activity${qs({ limit })}`);

/** One chart primitive fed by one shape (§7.1) — what makes insights everywhere
 *  affordable instead of a bespoke aggregate per feature. */
export const getDomainMetrics = (domain: Domain, days = 30) =>
  apiRequest<MetricSeries[]>(`/api/${domain}/metrics${qs({ days })}`);

// ── the entity layer ───────────────────────────────────────────────────────
//
// `/api/<scope>/entities/…` is the read/write path over the 244 consolidated
// tables (PRD 20 §5). ONE client for all of them, for the same reason there is
// ONE service behind it: the calls differ only in the entity name, and a
// per-entity client would be the duplication the consolidation exists to delete,
// three layers up from the schema.

/** The fifteen seats plus the kernel's shared primitives, which belong to no
 *  seat (§2) and so are addressed under their own scope. */
export type EntityScope = Domain | 'kernel';

export interface EntityField {
  name: string;
  type: string;
  required: boolean;
  writable: boolean;
  options: string[] | null;
}

export interface EntityDescriptor {
  name: string;
  kind: string;
  scope: EntityScope;
  /** False for a store scoped narrower than a tenant — declared, listed, and
   *  deliberately not served through a generic reader. */
  readable: boolean;
  writable: boolean;
  registers: boolean;
  titleField: string | null;
  fields: EntityField[];
  /** Columns that exist and are withheld. Named rather than hidden, so a surface
   *  can say so instead of implying the table is narrower than it is. */
  redactedFields: string[];
  count: number;
}

export type EntityRow = Record<string, unknown>;

export interface EntityPage {
  rows: EntityRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Every shape a seat owns, with its row count — one request, not one per
 *  entity, because the Growth seat owns 46 of them. */
export const getScopeEntities = (scope: EntityScope) =>
  apiRequest<EntityDescriptor[]>(`/api/${scope}/entities`);

export const getEntityRows = (
  scope: EntityScope,
  entity: string,
  opts: { limit?: number; offset?: number; q?: string; archived?: boolean } = {},
) => apiRequest<EntityPage>(`/api/${scope}/entities/${entity}${qs(opts)}`);

export const getEntityRow = (scope: EntityScope, entity: string, id: string) =>
  apiRequest<EntityRow>(`/api/${scope}/entities/${entity}/${encodeURIComponent(id)}`);

export const createEntityRow = (scope: EntityScope, entity: string, body: EntityRow) =>
  apiRequest<EntityRow>(`/api/${scope}/entities/${entity}`, { method: 'POST', body: JSON.stringify(body) });

export const updateEntityRow = (scope: EntityScope, entity: string, id: string, body: EntityRow) =>
  apiRequest<EntityRow>(`/api/${scope}/entities/${entity}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

/** Retire a row. Soft where the table declares a retirement column, hard only
 *  where it does not — the API decides, not the caller, so two surfaces cannot
 *  disagree about what delete means. */
export const archiveEntityRow = (scope: EntityScope, entity: string, id: string) =>
  apiRequest<{ archived: boolean; deleted: boolean }>(
    `/api/${scope}/entities/${entity}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
