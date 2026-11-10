/**
 * A cloud run's id in the shared run-id space (PRD 35 §8.2): the key of its `run_model_outcomes` row (`client_run_id`),
 * the `runId` the agent stamps on its outcome row, and the `parentRunId` a child it spawns points back at. The id itself
 * is spelled ONCE, in `@builderforce/run-delta` (`runIds.ts`), which the web reads too to find a cloud run's delta.
 *
 * The `cloud:` prefix namespaces the cloud's ids, but a prefix alone cannot stop a client from reporting one (the ingest takes any
 * string): so the ingest REFUSES a client-reported run id that starts with it ({@link isReservedClientRunId}), which is what
 * keeps the two id spaces from colliding.
 */
import { CLOUD_RUN_ID_PREFIX } from '@builderforce/run-delta/run-ids';

export { CLOUD_RUN_ID_PREFIX, cloudRunId } from '@builderforce/run-delta/run-ids';

/** A client-reported run id may not claim the cloud's namespace. */
export function isReservedClientRunId(clientRunId: string): boolean {
  return clientRunId.trim().startsWith(CLOUD_RUN_ID_PREFIX);
}
