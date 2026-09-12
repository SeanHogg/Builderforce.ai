/**
 * The Evermind coding gate's I/O half: persist a coding eval for a head version, and
 * resolve whether a run's `evermind/<ref>` route may serve a CODING turn.
 *
 * The verdict itself is pure and lives in {@link ./evermindCodingGate} — this module
 * only reads/writes the evidence and maps a model ref back to the head it names.
 *
 * Write path (from builderforce-memory's `EvalHarness`): run the SAME coding dataset
 * through the harness twice — once targeting the project's Evermind head, once the
 * frontier baseline — and POST both reports to `…/evermind/coding-eval`
 * (projectEvermindRoutes). The eval is stored stamped with the version it scored, and
 * refused (409 + `headVersion`) if a merge moved the head in between: an eval of v12
 * cannot vouch for v13.
 */
import { and, eq } from 'drizzle-orm';
import { projectEvermind } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { getProjectEvermindHead, invalidateProjectEvermindHead, PROJECT_EVERMIND_ROOT } from './projectEvermind';
import {
  evermindQualifiesForCoding,
  isEvermindModelId,
  type EvermindCodingEval,
  type EvermindCodingGate,
} from './evermindCodingGate';

export type RecordCodingEvalResult =
  | { ok: true; gate: EvermindCodingGate }
  | { ok: false; status: 409; headVersion: number; error: string };

/**
 * Persist `ev` as the head's coding eval — ONLY if `ev.version` is still the head
 * (the version guard is in the UPDATE's WHERE, so a merge racing the write cannot
 * leave an eval of the old weights attached to the new ones). Returns the gate's new
 * verdict, or the 409 a caller needs to re-run the eval against the current head.
 */
export async function recordProjectEvermindCodingEval(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  ev: EvermindCodingEval,
): Promise<RecordCodingEvalResult> {
  const updated = await db
    .update(projectEvermind)
    .set({
      codingEvalVersion: ev.version,
      codingEvalScore: ev.score,
      codingEvalBaselineScore: ev.baselineScore,
      codingEvalBaselineModel: ev.baselineModel,
      codingEvalDataset: ev.dataset,
      codingEvalAt: ev.evaluatedAt ? new Date(ev.evaluatedAt) : new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(projectEvermind.tenantId, tenantId),
      eq(projectEvermind.projectId, projectId),
      eq(projectEvermind.version, ev.version),
    ))
    .returning({ id: projectEvermind.id });
  if (updated.length > 0) await invalidateProjectEvermindHead(env, tenantId, projectId);
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (updated.length === 0) {
    return {
      ok: false,
      status: 409,
      headVersion: head.version,
      error: head.version > 0
        ? `the eval scored v${ev.version} but the head is v${head.version} — re-run it against the current head`
        : 'this project’s Evermind is not seeded — there is no head to evaluate',
    };
  }
  return { ok: true, gate: evermindQualifiesForCoding(head) };
}

/**
 * Map a direct Evermind route back to the project head it names:
 * `evermind/<PROJECT_EVERMIND_ROOT>/<tenantId>/<projectId>/v<version>` — the inverse
 * of `evermind/${projectEvermindRef(...)}`. Null for anything else (a published Studio
 * model, a malformed ref). Built per call so the root stays the ONE definition.
 */
export function parseProjectEvermindModel(model: string): { tenantId: number; projectId: number; version: number } | null {
  const prefix = `evermind/${PROJECT_EVERMIND_ROOT}/`;
  if (!model.startsWith(prefix)) return null;
  const m = /^(\d+)\/(\d+)\/v(\d+)$/.exec(model.slice(prefix.length));
  if (!m) return null;
  const [tenantId, projectId, version] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return tenantId > 0 && projectId > 0 && version > 0 ? { tenantId, projectId, version } : null;
}

/** The gate's answer for one Evermind route on a coding turn. */
export interface EvermindCodingRoute {
  model: string;
  qualified: boolean;
  /** The head's verdict, when the route named a project head this tenant owns. */
  gate?: EvermindCodingGate;
}

/**
 * May a CODING turn run on `model`? undefined when `model` is not an Evermind route
 * (nothing to gate). Otherwise qualified only when it names THIS tenant's project head,
 * at the CURRENT version (the eval is version-exact), and that head passes the gate.
 * A published Studio model has no per-head coding eval, so it never qualifies for a
 * coding turn. Best-effort: a read failure closes the gate rather than failing the run.
 */
export async function resolveEvermindCodingRoute(
  env: Env,
  db: Db,
  tenantId: number,
  model: string | undefined,
): Promise<EvermindCodingRoute | undefined> {
  if (!isEvermindModelId(model)) return undefined;
  const ref = parseProjectEvermindModel(model);
  if (!ref || ref.tenantId !== tenantId) return { model, qualified: false };
  try {
    const head = await getProjectEvermindHead(env, db, tenantId, ref.projectId);
    const gate = evermindQualifiesForCoding(head);
    return { model, qualified: gate.qualified && ref.version === head.version, gate };
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/evermindCodingEvalStore.ts', operation: 'resolveEvermindCodingRoute' });
    return { model, qualified: false };
  }
}
