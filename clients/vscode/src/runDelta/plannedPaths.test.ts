import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, UNBOUND_DESTINATION } from "@builderforce/local-first";
import { plannedPathsFor, type PathKinds } from "./plannedPaths";
import { runPlanTexts } from "./runPlanTexts";

const kinds = (known: Record<string, "file" | "folder">): PathKinds => async (_root, paths) =>
  new Map(paths.filter((p) => known[p]).map((p) => [p, known[p]!] as const));

describe("C8.3 planned paths (local-first plan source)", () => {
  it("reads the task, the chat's own tickets and its linked tickets", async () => {
    const store = createMemoryLocalFirstStore();
    const at = "2026-11-10T00:00:00.000Z";
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({ id: "t-own", entityType: "ticket", payload: { projectId: "p", title: "Own", description: "edit src/a.ts", status: "todo", chatClientId: "chat-1" }, deviceId: "d", destination: UNBOUND_DESTINATION, occurredAt: at }));
      await tx.put(newLocalRecord({ id: "t-linked", entityType: "ticket", payload: { projectId: "p", title: "Linked", status: "todo" }, deviceId: "d", destination: UNBOUND_DESTINATION, occurredAt: at }));
      await tx.put(newLocalRecord({ id: "t-other", entityType: "ticket", payload: { projectId: "p", title: "Other chat", status: "todo", chatClientId: "chat-2" }, deviceId: "d", destination: UNBOUND_DESTINATION, occurredAt: at }));
      await tx.put(newLocalRecord({ id: "l-1", entityType: "chat-ticket-link", payload: { chatClientId: "chat-1", ticketClientId: "t-linked" }, deviceId: "d", destination: UNBOUND_DESTINATION, occurredAt: at }));
    });
    expect(await runPlanTexts(store, "Do the thing", "chat-1")).toEqual(["Do the thing", "Linked\n", "Own\nedit src/a.ts"]);
    expect(await runPlanTexts(store, "  ", undefined)).toEqual([]);
  });

  it("resolves named paths against the changed files and a stat of the rest; nothing resolving is undefined", async () => {
    const texts = ["Fix src/a.ts and the docs/ folder; ignore src/gone.ts and lib/**/*.ts"];
    expect(await plannedPathsFor({ texts, root: "/r", changed: ["src/b.ts"], pathKinds: kinds({ "src/a.ts": "file", docs: "folder", lib: "folder" }) }))
      .toEqual(["docs/", "lib/**/*.ts", "src/a.ts"]);
    expect(await plannedPathsFor({ texts: ["just prose here"], root: "/r", changed: ["src/b.ts"], pathKinds: kinds({}) })).toBeUndefined();
    expect(await plannedPathsFor({ texts: ["edit src/b.ts"], root: "/r", changed: ["src/b.ts"], pathKinds: kinds({}) })).toEqual(["src/b.ts"]);
  });
});
