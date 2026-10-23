/**
 * Where an IMAGE run's model hand-off state lives between its `llm` ops.
 *
 * The durable loop carries its policy state in `CloudLoopState`; an image (the
 * Cloudflare Container or the GitHub Actions runner) owns its own loop and holds no
 * state the Worker can trust, and the Actions runner has no Durable Object behind it at
 * all. So the Worker keeps the state itself, keyed by execution id, and every `llm` op
 * reads it before the turn and writes it after — the image stays a step driver that
 * makes no model decisions, and an image that predates this needs no rebuild.
 *
 * Best-effort by contract, like every cache read and write (the cache reports its own
 * failures and reads them as a miss): a lost write costs at most the
 * policy's memory of ONE turn (a lock re-taken, a retry budget re-granted), never the
 * run. The TTL outlives any run, including one paused on a human question over a
 * weekend and resumed in a fresh process.
 */
import { peekCached, setCached } from '../../../infrastructure/cache/readThroughCache';
import type { Env } from '../../../env';
import type { CloudRunModelState } from './cloudRunModelPolicy';
import type { CascadeSessionState } from '../costLoop/verifierCascade';

/** A week: long enough for a run paused on a question to resume on the same state. */
const STATE_TTL_SECONDS = 7 * 86_400;

function stateKey(executionId: number): string {
  return `container-run-policy:${executionId}`;
}

export async function loadContainerRunModelState(env: Env, executionId: number): Promise<CloudRunModelState | undefined> {
  const saved = await peekCached<CloudRunModelState>(env, stateKey(executionId));
  return saved?.policy ? saved : undefined;
}

export async function saveContainerRunModelState(env: Env, executionId: number, state: CloudRunModelState): Promise<void> {
  await setCached(env, stateKey(executionId), state, { kvTtlSeconds: STATE_TTL_SECONDS });
}

/** The D1 cascade's state for an image run (`imageCascade.ts`), beside the model state:
 *  its units, the seed's softness and action type, and the model the last turn resolved
 *  to (the attempt the next verdict judges). Written only while the lever is on. */
export interface ContainerRunCascadeState {
  cascade: CascadeSessionState;
  resolvedModel?: string;
}

function cascadeKey(executionId: number): string {
  return `container-run-cascade:${executionId}`;
}

export async function loadContainerRunCascade(env: Env, executionId: number): Promise<ContainerRunCascadeState | undefined> {
  const saved = await peekCached<ContainerRunCascadeState>(env, cascadeKey(executionId));
  return saved?.cascade ? saved : undefined;
}

export async function saveContainerRunCascade(env: Env, executionId: number, state: ContainerRunCascadeState): Promise<void> {
  await setCached(env, cascadeKey(executionId), state, { kvTtlSeconds: STATE_TTL_SECONDS });
}
