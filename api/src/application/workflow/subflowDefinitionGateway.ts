/**
 * THE ONE TENANT-SCOPED READ OF A NESTED CANVAS'S DEFINITION.
 *
 * `expandSubflows` is pure over a loader port so it can be tested with a Map. Two
 * places supply the real one — starting a run (`instantiateRun.ts`) and compiling a
 * process chart through the `compile()` primitive (`compileRoutes.ts`) — and they
 * must agree on the thing that matters: the read is scoped to the tenant whose work
 * this is, so composition can never reach a definition across the boundary however
 * a `subflow` node's config came to name one.
 *
 * That is exactly the rule a second copy eventually forgets, so there is one copy.
 */

import { and, eq } from 'drizzle-orm';
import { workflowDefinitions } from '../../infrastructure/database/schema';
import { parseDefinition } from '../../domain/workflowGraph';
import type { SubflowDefinitionLoader } from './expandSubflows';
import type { Db } from '../../infrastructure/database/connection';

/** A definition id, as the column actually stores them. Anything else cannot be a
 *  row, and asking Postgres about it raises rather than returning nothing. */
const DEFINITION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function subflowDefinitionLoader(db: Db, tenantId: number): SubflowDefinitionLoader {
  return async (definitionId) => {
    if (!DEFINITION_ID.test(definitionId)) return null;
    const [row] = await db
      .select({ name: workflowDefinitions.name, definition: workflowDefinitions.definition })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, tenantId)))
      .limit(1);
    return row ? { name: row.name, definition: parseDefinition(row.definition) } : null;
  };
}
