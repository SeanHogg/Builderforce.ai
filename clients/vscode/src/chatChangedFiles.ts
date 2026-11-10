/**
 * The "Changes" pill's LOCAL scope source (local-first default, G19/G21).
 *
 * The webview's pill scopes the workspace's pending changes to the files ONE chat
 * changed. That list used to come only from the server (`GET /api/brain/chats/:id/files`,
 * the chat's synced `work_deltas`) — which fails offline and lags until a sync lands.
 * The host already captures run-linked immutable `change-set` records LOCALLY at the end
 * of every host-owned run (`runChangeSets.ts`), one per touched repo, each carrying the
 * attributed repo-relative file paths. This reads those local records so the pill
 * answers with no platform; the server stays only the sync/merge backstop.
 *
 * A chat is named by a {@link ChatRef} (a NUMBER is its SERVER id; a STRING its local
 * client id) and resolved through the SAME `resolveChat` the rail uses, so both resolve
 * offline and agree on which chat a ref names. A host run's change-set id embeds the
 * chat's local numeric id (`host-run:<chatId>:<uuid>`, `changeSetIdentityForHostRun`),
 * so we scan the `change-set` type once and keep the records whose run id belongs to
 * this chat.
 *
 * An unknown / never-edited chat answers `found:false` (the caller keeps the server /
 * keep-all fallback); a chat with no recorded files answers `found:true, files:[]` so
 * the pill shows no count rather than the workspace's pre-existing dirt. Never `null`:
 * a local read always settles. Pure read — no fetch, no mutation, no journal append.
 */

import { isIntegerIdText, type EntityScope, type LocalFirstStore, type LocalFirstTransaction } from "@builderforce/local-first";
import type { ChatRef } from "./chatRail/railProtocol";
import { resolveChat } from "./chatRail/resolveChat";
import type { LocalChangeSetValue } from "./runChangeSets";

export type ChatChangedFilesResult =
  | { found: true; files: string[] }
  | { found: false };

/**
 * A chat's local numeric VIEW KEY from its id text (not a LocalId, not a SyncId: the brain's own
 * positive chat number). Integer text goes through the one `isIntegerIdText` check.
 */
function viewKeyOf(text: string): number | undefined {
  if (!isIntegerIdText(text)) return undefined;
  const key = Number(text);
  return Number.isSafeInteger(key) && key > 0 ? key : undefined;
}

/** The local numeric chat id a chat record carries, when it holds one. */
function localChatNumberOf(record: { id: string; payload?: unknown } | undefined): number | undefined {
  if (!record) return undefined;
  const fromPayload = Number((record.payload as { rootChatId?: unknown } | undefined)?.rootChatId);
  if (Number.isSafeInteger(fromPayload) && fromPayload > 0) return fromPayload;
  return viewKeyOf(record.id);
}

/** Resolve a ref to its local numeric chat id (what a host-run change-set id embeds). */
async function resolveLocalChatNumber(tx: LocalFirstTransaction, ref: ChatRef, scope: EntityScope | undefined): Promise<number | undefined> {
  const chat = await resolveChat(tx, ref, scope);
  if (!chat) return undefined;
  const record = await tx.get("chat", chat.clientId);
  return localChatNumberOf(record) ?? viewKeyOf(chat.clientId);
}

/**
 * The distinct repo-relative paths the chat's runs recorded changing, from local
 * change-set records only.
 */
export async function readLocalChatChangedFiles(
  store: LocalFirstStore,
  ref: ChatRef,
  /** The active account: a server chat id names that tenant's chat only. */
  scope?: EntityScope,
): Promise<ChatChangedFilesResult> {
  let rootChatId: number | undefined;
  await store.read(async (tx) => {
    rootChatId = await resolveLocalChatNumber(tx, ref, scope);
  });
  if (rootChatId === undefined) return { found: false };

  const prefix = `host-run:${rootChatId}:`;
  const files = new Set<string>();
  await store.read(async (tx) => {
    await tx.scan<LocalChangeSetValue>("change-set", (row) => {
      if (row.deletedAt) return;
      // Only the attributed per-repo diffs carry files; the `changeset-lifecycle:*`
      // rows stay empty by construction (see changeSetLifecycle.ts).
      if (typeof row.payload?.runId !== "string" || !row.payload.runId.startsWith(prefix)) return;
      for (const file of row.payload.files ?? []) {
        if (file && typeof file.path === "string" && file.path) files.add(file.path);
      }
    });
  });

  return { found: true, files: [...files] };
}
