/**
 * A cloud run's id in the shared run-id space (PRD 35 §8.2): the key of its `run_model_outcomes` row (`client_run_id`),
 * the `runId` the agent stamps on its outcome row, and the `parentRunId` a child it spawns points back at.
 *
 * The `cloud:` prefix namespaces the cloud's ids, but a prefix alone cannot stop a client from reporting one (the ingest takes any
 * string): so the ingest REFUSES a client-reported run id that starts with it ({@link isReservedClientRunId}), which is what
 * keeps the two id spaces from colliding.
 */
export const CLOUD_RUN_ID_PREFIX = 'cloud:';

export function cloudRunId(executionId: number): string {
  return `${CLOUD_RUN_ID_PREFIX}${executionId}`;
}

/** A client-reported run id may not claim the cloud's namespace. */
export function isReservedClientRunId(clientRunId: string): boolean {
  return clientRunId.trim().startsWith(CLOUD_RUN_ID_PREFIX);
}
