/**
 * run-delta/runIds.ts — a cloud run's id in the shared run-id space (PRD 35 §8.2), ONCE: the key a cloud execution's
 * delta is stored and read under (`GET /api/run-deltas/:runId`), its `run_model_outcomes` row and the `parentRunId` a child
 * points back at. The API (`api/src/domain/execution/cloudRunId.ts`) and the web (`frontend/src/lib/runDeltasApi.ts`) both
 * read it from here. Pure.
 */

export const CLOUD_RUN_ID_PREFIX = 'cloud:';

export function cloudRunId(executionId: number): string {
    return `${CLOUD_RUN_ID_PREFIX}${executionId}`;
}
