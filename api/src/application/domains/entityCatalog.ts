/**
 * THE catalog — every consolidated table, in exactly one place (PRD 20 §5, §6.3).
 *
 * This is the file `check-table-adoption.mjs` measures against. A table that
 * reaches production without an entry here has no code path, and the guard says
 * so by name rather than as a number that quietly drifts.
 *
 * ONE registry, sixteen declarations, and no lookup that scans: the two maps
 * below are built once at module load, so resolving `(scope, entity)` on a
 * request is a `Map.get` rather than a linear search over 244 definitions on
 * every call.
 */
import { AGENTS_ENTITIES } from './agents/entities';
import { CANVAS_ENTITIES } from './canvas/entities';
import { COMMERCE_ENTITIES } from './commerce/entities';
import { DELIVERY_ENTITIES } from './delivery/entities';
import { FINANCE_ENTITIES } from './finance/entities';
import { GOVERNANCE_ENTITIES } from './governance/entities';
import { GROWTH_ENTITIES } from './growth/entities';
import { HIRING_ENTITIES } from './hiring/entities';
import { IDENTITY_ENTITIES } from './identity/entities';
import { INTEGRATIONS_ENTITIES } from './integrations/entities';
import { INVESTOR_ENTITIES } from './investor/entities';
import { KERNEL_ENTITIES } from './kernel/entities';
import { PEOPLE_ENTITIES } from './people/entities';
import { PLATFORM_ENTITIES } from './platform/entities';
import { REVENUE_ENTITIES } from './revenue/entities';
import { SUPPORT_ENTITIES } from './support/entities';
import type { EntityDef, EntityScope } from './entityDefinition';

export const ENTITY_CATALOG: readonly EntityDef[] = [
  ...KERNEL_ENTITIES,
  ...AGENTS_ENTITIES,
  ...CANVAS_ENTITIES,
  ...COMMERCE_ENTITIES,
  ...DELIVERY_ENTITIES,
  ...FINANCE_ENTITIES,
  ...GOVERNANCE_ENTITIES,
  ...GROWTH_ENTITIES,
  ...HIRING_ENTITIES,
  ...IDENTITY_ENTITIES,
  ...INTEGRATIONS_ENTITIES,
  ...INVESTOR_ENTITIES,
  ...PEOPLE_ENTITIES,
  ...PLATFORM_ENTITIES,
  ...REVENUE_ENTITIES,
  ...SUPPORT_ENTITIES,
];

const byName = new Map<string, EntityDef>(ENTITY_CATALOG.map((e) => [e.name, e]));

const byScope = new Map<EntityScope, EntityDef[]>();
for (const def of ENTITY_CATALOG) {
  const list = byScope.get(def.scope);
  if (list) list.push(def);
  else byScope.set(def.scope, [def]);
}

/** Every entity a seat owns, in declaration order — roots first, by convention
 *  of how the per-domain files are written, so a surface's first tab is the
 *  thing the seat is actually about. */
export function entitiesForScope(scope: EntityScope): readonly EntityDef[] {
  return byScope.get(scope) ?? [];
}

/**
 * Resolve one entity, scoped.
 *
 * The scope is checked, not just used for lookup: a table name is unique across
 * the schema, so `/api/finance/entities/job_applications` WOULD resolve if this
 * matched on name alone — and a seat that can read another seat's tables through
 * its own URL is the domain boundary of §3 leaking at the API.
 */
export function findEntity(scope: EntityScope, name: string): EntityDef | null {
  const def = byName.get(name);
  return def && def.scope === scope ? def : null;
}

/** Entities that register their rows in `objects`, for the projection sweep. */
export function registeredEntities(): readonly EntityDef[] {
  return ENTITY_CATALOG.filter((e) => e.registers);
}
