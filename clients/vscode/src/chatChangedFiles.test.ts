/**
 * The "Changes" pill's local scope source (G19/G21): readLocalChatChangedFiles answers a
 * chat's changed files from LOCAL run-linked change-set records, with the platform denied.
 */

import { describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type EntityDestination,
  type LocalFirstStore,
} from "@builderforce/local-first";
import { readLocalChatChangedFiles } from "./chatChangedFiles";

const DEST: EntityDestination = { kind: "bound", platformInstance: "https://api.example", tenantId: "tenant-1" };
const LOCAL_CHAT = "00000000-0000-4000-8000-0000000000c1";
const SERVER_CHAT = 7;

/** A chat bound to a server id; its local numeric id (what a host-run change-set id embeds). */
async function seededChat(store: LocalFirstStore, localNumber: number): Promise<void> {
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({
      id: LOCAL_CHAT, entityType: "chat", deviceId: "device-1", destination: DEST,
      payload: { clientId: LOCAL_CHAT, rootChatId: localNumber, chat: { id: localNumber, title: "A chat" } },
    }));
    await tx.putMapping({ destination: DEST, entityType: "chat", clientEntityId: LOCAL_CHAT, serverId: String(SERVER_CHAT), serverVersion: 1 });
  });
}

/** One immutable change-set record for a host run of `chatNumber`, carrying the given repo-relative paths. */
async function putChangeSet(store: LocalFirstStore, chatNumber: number, runUuid: string, paths: string[]): Promise<void> {
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({
      id: `changeset:host-run:${chatNumber}:${runUuid}:0aaaaaaaaaaaaaaa`,
      entityType: "change-set",
      deviceId: "device-1",
      destination: DEST,
      payload: {
        runId: `host-run:${chatNumber}:${runUuid}`,
        repository: "repo",
        branch: "main",
        files: paths.map((path) => ({ path, attribution: "authored", status: "modified" })),
        author: "agent:brain-host",
        capturedAt: "2026-11-08T12:00:00.000Z",
      },
    }));
  });
}

describe("readLocalChatChangedFiles", () => {
  it("answers the chat's distinct changed files from local change-set records, by server id", async () => {
    const store = createMemoryLocalFirstStore();
    await seededChat(store, 42);
    await putChangeSet(store, 42, "aaaa", ["src/a.ts", "src/b.ts"]);
    await putChangeSet(store, 42, "bbbb", ["src/b.ts", "README.md"]);

    const result = await readLocalChatChangedFiles(store, SERVER_CHAT);
    expect(result.found).toBe(true);
    expect(result.files?.sort()).toEqual(["README.md", "src/a.ts", "src/b.ts"]);
  });

  it("answers by local client id too, and a never-edited chat owns no files", async () => {
    const store = createMemoryLocalFirstStore();
    await seededChat(store, 42);

    const edited = await readLocalChatChangedFiles(store, LOCAL_CHAT);
    expect(edited).toEqual({ found: true, files: [] });
  });

  it("ignores another chat's change sets and the empty lifecycle rows", async () => {
    const store = createMemoryLocalFirstStore();
    await seededChat(store, 42);
    await putChangeSet(store, 99, "cccc", ["other/x.ts"]); // a different chat's run
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({
        id: "changeset-lifecycle:host-run:42:dddd",
        entityType: "change-set",
        deviceId: "device-1",
        destination: DEST,
        payload: { kind: "lifecycle", runId: "host-run:42:dddd", repository: "repo", files: [], author: "agent:brain-host", baselineHash: "sha256:x", baseline: { repos: [] } },
      }));
    });

    const result = await readLocalChatChangedFiles(store, SERVER_CHAT);
    expect(result).toEqual({ found: true, files: [] });
  });

  it("found:false when the store holds no such chat (caller falls back to the server)", async () => {
    const store = createMemoryLocalFirstStore();
    const result = await readLocalChatChangedFiles(store, SERVER_CHAT);
    expect(result).toEqual({ found: false });
  });
});
