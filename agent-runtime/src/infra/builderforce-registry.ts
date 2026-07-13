/**
 * builderforce-registry (builderforce-registry)
 *
 * Provides a stable mapping from Agent Types to BuilderForce engine identifiers.
 */

const AGENT_TYPES: Record<number, string> = {
  1: 'builderforce-v1',
  2: 'builderforce-v2',
};

/**
 * getBuilderForceEngineFromEngineType
 *
 * Returns the BuilderForce engine identifier for a given agent-type code.
 *
 * @param {number} engineType — 1 for builderforce-v1, 2 for builderforce-v2.
 * @returns {string}
 */
export function getBuilderForceEngineFromEngineType(engineType: number): string {
  const engine = AGENT_TYPES[engineType];
  if (!engine) {
    throw new Error(`[BuilderForce] Unknown engine type: ${engineType}`);
  }
  return engine;
}