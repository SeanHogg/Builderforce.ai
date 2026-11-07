/**
 * The ONLY place the parity harness excuses a difference between a run's record and the one stored for its scenario (`snapshots/`). Every rule below
 * is named with the reason it is not a behavioural difference. Adding a rule widens what the suite
 * cannot see: a rule that hides something the agent decides is a defect in this file, not a feature.
 *
 *  1. Run ids. `metadata.guestTurnId` is `crypto.randomUUID()` per run (`runPreamble.ts`), so two runs
 *     of one scenario can never share it. Each distinct id becomes `<id:N>` by order of first
 *     appearance, so a run that reuses one id where the other minted two is still seen.
 *  2. Wall-clock instants, by key: `ts`, `createdAt`, `startedAt`, `at`. Every run stamps `new Date()`.
 *  3. Measured durations, by key: `durationMs`, `ttftMs`, `elapsedMs`. They are timings of the machine,
 *     not decisions. Kept as `<ms>` so a step that has one in one record and none in the other is seen.
 *  4. ISO-8601 instants inside text (a system prompt's clock line, a step's wording): same as rule 2.
 *
 *  5. Epoch-ms run clocks. `clientRunId` is `ide:<run key>:<Date.now() at start>` (`runOutcomeReport.ts`); the
 *     13-digit suffix is `<epoch>`. The key before it is kept.
 *  6. The wire's own defaults (`wireEquivalent`). The request options are compared as the gateway body
 *     `streamChatCompletion.ts` builds from them, so an option that body omits or defaults is equal to its absence:
 *     `modelStrict: false`, or true with no `model` (`strict` is set only when true AND a model is named), `maxTokens` absent (`max_tokens` defaults to 4096),
 *     `reasoning: off` (the key is omitted), an empty `tools` list (omitted), `tool_choice` absent beside tools
 *     (`auto`), an empty `metadata`. A DIFFERENT value (16384 against 4096) is not touched.
 *
 *  7. The agent's uniform telemetry (`withoutUniformTelemetry`, approved by the coordinator, PRD 35 section 8.2). On a graded run the
 *     agent's outcome row carries 17 optional fields the stored (old loop) row has no place for: entryPoint, toolCalls, toolErrors, tokens,
 *     cacheReadTokens, compactions, stallRecoveries, escalations, coveredReadStubs, shellFileReads, repoErrors, contextPackTokens,
 *     unkeptReadyClaims, verify, firstSpawnTurn, modelPreflight, progressTrips. They are the agent's own telemetry and exist only on
 *     the agent, so they are dropped from `outcome.reported[]`. Every field the stored row also carries (steps, model, source, merged,
 *     terminalStatus, clientRunId, ...) is compared as it is: a wrong `steps` stays a failure.
 *  8. `agentOnly.recorded` (the agent's `reportRunRecord`, for a run with no grade) is not compared with the stored record, which has no such
 *     report; the suites assert instead that no run reports twice (`atMostOneReportPerRun`).
 *  9. The utility role on summary requests (`wireEquivalent`, PRD 42 C1, archived in DONE.md). The agent stamps `role: 'utility'` on the
 *     summarizer/fold request so the gateway can route it to the utility tier; the stored (old loop) request has no such field. Only
 *     `role === 'utility'` on a request the harness marked `summary: true` is dropped; any other role, or a utility role on a
 *     non-summary request, is still a difference.
 *
 * Nothing else is normalised: not message order, not step numbers, not counts, not wording.
 */

import { DEFAULT_MAX_TOKENS } from '../../effort';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// `runPreamble.ts` falls back to `<epoch ms>-<base36>` where `crypto.randomUUID` is absent.
const FALLBACK_ID = /\b\d{13}-[a-z0-9]{6,}\b/g;
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

const INSTANT_KEYS = new Set(['ts', 'createdAt', 'startedAt', 'at']);
const DURATION_KEYS = new Set(['durationMs', 'ttftMs', 'elapsedMs']);

const EPOCH_RUN_CLOCK = /\b(ide:\d+:)\d{13}\b/g;

/** Rule 6: one request's options reduced to what the gateway body would carry. */
export function wireEquivalent<T extends Record<string, unknown>>(call: T): T {
  const out: Record<string, unknown> = { ...call };
  if (out.modelStrict === false || (out.modelStrict === true && !out.model)) delete out.modelStrict;
  if (out.maxTokens === undefined) out.maxTokens = DEFAULT_MAX_TOKENS;
  if ((out.reasoning as { level?: string } | undefined)?.level === 'off') delete out.reasoning;
  if (Array.isArray(out.tools) && out.tools.length === 0) delete out.tools;
  if (out.tools !== undefined && out.tool_choice === undefined) out.tool_choice = 'auto';
  if (out.metadata && Object.keys(out.metadata as object).length === 0) delete out.metadata;
  if (out.summary === true && out.role === 'utility') delete out.role; // rule 9 (PRD 42 C1)
  return out as T;
}

const UNIFORM_TELEMETRY = [
  'entryPoint', 'toolCalls', 'toolErrors', 'tokens', 'cacheReadTokens', 'compactions', 'stallRecoveries', 'escalations',
  'coveredReadStubs', 'shellFileReads', 'repoErrors', 'contextPackTokens', 'unkeptReadyClaims', 'verify', 'firstSpawnTurn',
  'modelPreflight', 'progressTrips',
] as const;

/** Rule 7: the outcome rows without the agent's uniform telemetry. */
export function withoutUniformTelemetry<T extends { outcome: { reported: unknown[] } }>(record: T): T {
  const reported = record.outcome.reported.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const k of UNIFORM_TELEMETRY) delete copy[k];
    return copy;
  });
  return { ...record, outcome: { ...record.outcome, reported } };
}

/** A normaliser with its own id numbering: one per record, so a record is numbered from 1. */
export function normaliser(): <T>(value: T) => T {
  const ids = new Map<string, number>();
  const idOf = (raw: string): string => {
    let n = ids.get(raw);
    if (n === undefined) { n = ids.size + 1; ids.set(raw, n); }
    return `<id:${n}>`;
  };
  const text = (s: string): string => s.replace(UUID, idOf).replace(EPOCH_RUN_CLOCK, '$1<epoch>').replace(FALLBACK_ID, idOf).replace(ISO_INSTANT, '<iso>');
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return key && INSTANT_KEYS.has(key) ? '<iso>' : text(v);
    if (typeof v === 'number') return key && DURATION_KEYS.has(key) ? '<ms>' : v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x === undefined) continue;
        out[text(k)] = walk(x, k);
      }
      return out;
    }
    return v;
  };
  return (value) => walk(value) as typeof value;
}

/** Normalise a whole record. */
export function normalise<T>(record: T): T {
  return normaliser()(record);
}
