/**
 * The PRD 35 §8.2 uniform outcome row → its `run_model_outcomes` columns.
 *
 * The fields arrive validated (`parseRunOutcomeTelemetry`, `@builderforce/learned-routing`),
 * so this only maps names to columns and spells each column's "not reported" value: the
 * NOT NULL DEFAULT columns (compactions, stall_recoveries, escalations, verify) take their
 * default, every other one stays NULL — "not measured", never a reported zero.
 */

import type { RunOutcomeTelemetry } from '@builderforce/learned-routing';

export function runOutcomeTelemetryColumns(t: RunOutcomeTelemetry) {
  return {
    entryPoint:        t.entryPoint ?? null,
    toolCalls:         t.toolCalls ?? null,
    toolErrors:        t.toolErrors ?? null,
    tokens:            t.tokens ?? null,
    cacheReadTokens:   t.cacheReadTokens ?? null,
    compactions:       t.compactions ?? 0,
    stallRecoveries:   t.stallRecoveries ?? 0,
    escalations:       t.escalations ?? 0,
    verify:            t.verify ?? 'not-run',
    firstSpawnTurn:    t.firstSpawnTurn ?? null,
    coveredReadStubs:  t.coveredReadStubs ?? null,
    shellFileReads:    t.shellFileReads ?? null,
    repoErrors:        t.repoErrors ?? null,
    contextPackTokens: t.contextPackTokens ?? null,
    modelPreflight:    t.modelPreflight ?? null,
    unkeptReadyClaims: t.unkeptReadyClaims ?? null,
    progressTrips:     t.progressTrips ?? null,
    // The row's own run id is the request's `clientRunId` (`client_run_id`, set beside these
    // columns), so only the owner a sub-agent's row points at is new.
    parentRunId:       t.parentRunId ?? null,
  };
}
