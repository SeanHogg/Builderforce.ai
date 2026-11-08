/**
 * A pack's push to the linked project (PRD 40 OD-2; PRD 41 A7): THE writer the linked review uses — the
 * replica pump — over the pack's snapshot as the "local" store. It is the first-sync case with a stricter
 * contract than a background replica, because the person is waiting for it:
 *
 *   - 401/403 stop it at once (the existing 403 handling shows the refusal);
 *   - three transient failures in a row stop it (`PackUploadUnreachable`, the caller offers Retry);
 *   - ANY failure means the pack is not fully on the project: `PackUploadIncomplete`, never
 *     a success.
 *
 * Progress counts SOURCES (the pack's files): the parts of the one pack sent, scaled to them. No vscode import: tested directly.
 */

import {
  createReplicaQueue, enqueueSources, memoryReplicaPersistence, pumpReplica,
  type FirstSyncCounts, type PortableKnowledgePack, type ReplicaState,
} from "@builderforce/agent-tools/knowledge";
import { KnowledgeApiError, type KnowledgeClient } from "@builderforce/knowledge-client";
import { localSnapshotStore } from "@seanhogg/builderforce-memory/knowledge";

/** Transient failures in a row after which the upload stops and offers Retry. */
export const PACK_TRANSIENT_STREAK = 3;

/** Every source of the pack: its ref and the hash its extracted output is keyed under. */
export const sourcesOf = (pack: PortableKnowledgePack): Array<{ ref: string; hash: string }> =>
  Object.entries(pack.snapshot.extracted).flatMap(([hash, list]) => list.map((e) => ({ ref: e.sourceRef as string, hash })));

/** The server could not be reached (or kept rate limiting) three times in a row. */
export class PackUploadUnreachable extends Error {
  constructor() { super("pack upload: the server could not be reached"); this.name = "PackUploadUnreachable"; }
}

/** Some of the pack was skipped (too large) or refused: what is on the project is incomplete. */
export class PackUploadIncomplete extends Error {
  constructor(readonly items: number) { super(`pack upload: ${items} item(s) skipped or refused`); this.name = "PackUploadIncomplete"; }
}

/** Undefined when `signal` aborted (cancelled). */
export async function pushPack(
  pack: PortableKnowledgePack,
  client: KnowledgeClient,
  signal: AbortSignal,
  onProgress: (sourcesDone: number, sources: number) => void,
  /** Injected for tests: how a wait between retries passes. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<FirstSyncCounts | undefined> {
  const local = localSnapshotStore({ read: async () => JSON.stringify(pack.snapshot), write: async () => undefined });
  const queue = createReplicaQueue(memoryReplicaPersistence());
  const counts = await enqueueSources({ rootId: pack.rootId, local, queue, current: sourcesOf(pack) });
  // One pack (in parts when large): progress is the parts sent, scaled to the pack's sources.
  const onState = (s: ReplicaState): void => {
    if (s.parts && s.parts.total > 0) onProgress(Math.floor((counts.sources * s.parts.sent) / s.parts.total), counts.sources);
  };
  const state = await pumpReplica({
    queue, local, client, signal, maxTransientStreak: PACK_TRANSIENT_STREAK, rootId: pack.rootId, onState, ...(sleep ? { sleep } : {}),
    sources: async () => sourcesOf(pack),
  });
  if (!state.paused && state.failed.length === 0) onProgress(counts.sources, counts.sources);
  if (signal.aborted) return undefined;
  if (state.paused === "auth") throw new KnowledgeApiError(state.pausedStatus ?? 403, "forbidden", "knowledge API refused the upload");
  if (state.paused === "unreachable") throw new PackUploadUnreachable();
  const refused = state.failed.filter((f) => f.status === 403 || f.status === 401)[0];
  if (refused) throw new KnowledgeApiError(refused.status ?? 403, "forbidden", refused.reason);
  // A portable pack has no review to answer a held-back file, so one the pump held back (no extracted body) is as incomplete as a refused one.
  const incomplete = state.failed.length + (state.awaitingReview ?? 0);
  if (incomplete > 0) throw new PackUploadIncomplete(incomplete);
  return counts;
}
