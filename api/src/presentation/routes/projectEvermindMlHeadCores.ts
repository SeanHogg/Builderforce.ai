/**
 * The project Evermind's FEDERATED ML-HEAD handlers (`evermindMlHeads`) — the delta
 * door's head branch and the head read, kept beside `projectEvermindRoutes.ts` so that
 * router only wires them.
 *
 *   POST /learn  with `target: 'ml:<task>'` naming a registered head — a host's head delta
 *                (Hybrid's `run.local-success`), merged into THAT head by the coordinator's
 *                eval-gated FedAvg; never the LM.
 *   GET  /ml-head?target=ml:<task> — the project's merged head, cached until the next merge.
 *
 * Neither goes through the inherited-Evermind refusal: a head lives in this project's own
 * coordinator whether or not the project has an LM of its own, so there is nothing to
 * inherit and no other project to redirect the caller to.
 */
import type { Env } from '../../env';
import { dispatchProjectEvermindHeadLearn, readProjectEvermindMlHead } from '../../application/llm/evermindMlHeadDispatch';
import { mlHeadDoorFor, parseMlHeadContribution, type MlHeadDoor } from '../../application/llm/evermindMlHeads';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Learn into a federated head. The caller has checked the project and the body size. */
export async function mlHeadLearnCore(env: Env, tenantId: number, projectId: number, body: Record<string, unknown>, door: MlHeadDoor): Promise<Response> {
  // Refused early here with the coordinator's own shapes; the coordinator parses again.
  const parsed = parseMlHeadContribution(body, door);
  if (!parsed.ok) return json(parsed.refusal.body, parsed.refusal.status);
  const result = await dispatchProjectEvermindHeadLearn(env, tenantId, projectId, body);
  return json(result.body, result.status);
}

/** Read a federated head. The caller has checked the project. */
export async function mlHeadReadCore(env: Env, tenantId: number, projectId: number, target: string | undefined): Promise<Response> {
  const door = mlHeadDoorFor(target);
  if (!door) return json({ ok: false, error: `target ${target ?? '(none)'} is not a federated ML head` }, 400);
  try {
    const result = await readProjectEvermindMlHead(env, tenantId, projectId, door.target);
    return json(result.body, result.status);
  } catch (error) {
    reportCaughtError(error, { source: 'presentation/routes/projectEvermindMlHeadCores.ts', operation: 'mlHeadRead', context: { tenantId, projectId, target: door.target } });
    return json({ ok: false, error: 'the project coordinator could not serve the head' }, 502);
  }
}
