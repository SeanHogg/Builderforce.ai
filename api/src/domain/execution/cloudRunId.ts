/**
 * A cloud run's id in the shared run-id space (PRD 35 §8.2): the key of its `run_model_outcomes` row (`client_run_id`),
 * the `runId` the agent stamps on its outcome row, and the `parentRunId` a child it spawns points back at. Namespaced so it
 * can never collide with an id a client reports for its own runs.
 */
export const CLOUD_RUN_ID_PREFIX = 'cloud:';

export function cloudRunId(executionId: number): string {
  return `${CLOUD_RUN_ID_PREFIX}${executionId}`;
}
