/**
 * THE RUN VARIABLES A STEP CAN READ.
 *
 * A step publishes run variables three ways: a declared DATA OUT (lowered into a
 * `set-variables` capture by `compileBoardFlow`), a Set Variable step, and a Set
 * Variables step. Any later step's declared DATA IN can read one through the
 * `$vars` path the API joins into every expression context (`RUN_VARIABLES_KEY`
 * in `api/src/domain/workflowExpr.ts`) — so `$vars.orderId` works where only
 * `order.id` in the payload directly in front of the step used to.
 *
 * Only UPSTREAM steps count: a variable published by a step that runs later has
 * not been written yet when this one reads it, and offering it would be a
 * suggestion that resolves to nothing.
 */

import { FLOW_STEP_KIND, stepConfigOf, stepKindOf, stepOutputsOf } from './flowStepObject';

/** The path prefix an expression reads a run variable through. */
export const RUN_VARIABLES_PATH = '$vars';

interface BoardObject {
  id: string;
  data: Record<string, unknown>;
}

interface BoardConnection {
  source: string;
  target: string;
}

/** The names a Set Variables step's `values` map declares (a JSON string or an object). */
function valueKeys(values: unknown): string[] {
  if (values && typeof values === 'object' && !Array.isArray(values)) return Object.keys(values);
  if (typeof values !== 'string' || !values.trim().startsWith('{')) return [];
  try {
    const parsed = JSON.parse(values) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

/** Every run variable one board object publishes when it runs. */
export function publishedRunVariables(data: Record<string, unknown>): string[] {
  if (data.kind !== FLOW_STEP_KIND) return [];
  const names = stepOutputsOf(data).map((output) => output.key);
  const kind: string = stepKindOf(data);
  const config = stepConfigOf(data);
  if (kind === 'set-variable' && typeof config.key === 'string') names.push(config.key);
  if (kind === 'set-variables') names.push(...valueKeys(config.values));
  return names.map((name) => name.trim()).filter(Boolean);
}

/** The run variables published by every step upstream of `stepId`, sorted and de-duplicated. */
export function upstreamRunVariables(
  stepId: string,
  objects: readonly BoardObject[],
  connections: readonly BoardConnection[],
): string[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const seen = new Set<string>([stepId]);
  const queue = [stepId];
  const names = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const connection of connections) {
      if (connection.target !== current || seen.has(connection.source)) continue;
      seen.add(connection.source);
      queue.push(connection.source);
      const object = byId.get(connection.source);
      if (object) for (const name of publishedRunVariables(object.data)) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The DATA IN path that reads one run variable. */
export function runVariablePath(name: string): string {
  return `${RUN_VARIABLES_PATH}.${name}`;
}
