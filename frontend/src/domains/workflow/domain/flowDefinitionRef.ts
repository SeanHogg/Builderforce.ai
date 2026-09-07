/**
 * THE LINK FROM A BOARD TO THE DEFINITION IT WAS BUILT INTO.
 *
 * Building a section writes `resourceId: 'workflow:<id>'` onto the frame, and that
 * one string is how three different questions get answered: whether a frame is a
 * built flow (`canvasFlowTarget.ts`), whether a build should UPDATE a definition or
 * create one (`CreationCanvas`'s build), and — since composition — which definition
 * a nested canvas offers to a parent that binds to it live
 * (`LoadSubflowBoard.ts`).
 *
 * Three call sites had, or would have had, their own `startsWith('workflow:')` and
 * their own `slice(9)`. That is exactly the shape of thing that survives a rename
 * in two places out of three, so the prefix is written down once, here, and nobody
 * else spells it.
 */

const FLOW_DEFINITION_PREFIX = 'workflow:';

/** The definition a board object was built into, or null when it never was. */
export function flowDefinitionIdOf(data: Record<string, unknown>): string | null {
  const resourceId = data.resourceId;
  if (typeof resourceId !== 'string' || !resourceId.startsWith(FLOW_DEFINITION_PREFIX)) return null;
  const id = resourceId.slice(FLOW_DEFINITION_PREFIX.length).trim();
  return id || null;
}

/** The `resourceId` a build writes back onto the frame it just built. */
export function flowDefinitionRef(definitionId: string): string {
  return `${FLOW_DEFINITION_PREFIX}${definitionId}`;
}
