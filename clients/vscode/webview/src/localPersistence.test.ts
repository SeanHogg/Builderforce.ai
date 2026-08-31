import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryPersistence } from "./localPersistence";

/**
 * The store a signed-out on-device chat runs on.
 *
 * The first case is the regression itself. The run loop persists the user turn BEFORE it
 * streams — `sendMessages` is awaited, and only then does `startRun` reach the model — so
 * with the gateway adapter and no token, a signed-out local chat died on a 401 at a step
 * that has nothing to do with which model was picked. The panel rendered, the send
 * failed, and the model was never called at all. A unit test of the transport, the
 * bridge, or the route would all have passed.
 *
 * The other load-bearing case is `omits what it cannot honestly do`: these members are
 * optional in the adapter precisely so a guest backend can decline them, and the loop
 * takes a documented fallback when they are absent. Stubbing them to resolve would make
 * the loop believe an unread mark, a live subscription or an agent run had happened.
 */

const LABELS = { summarizeUnavailable: "needs an account" };
const store = () => createInMemoryPersistence(LABELS);

describe("signed-out chat store", () => {
  it("completes the loop's persist-then-stream sequence without an account", async () => {
    const p = store();
    const chat = await p.createChat({ title: "New chat", projectId: null });
    const [user] = await p.sendMessages(chat.id, [{ role: "user", content: "hello" }]);
    const [assistant] = await p.sendMessages(chat.id, [{ role: "assistant", content: "hi" }]);

    expect(user.content).toBe("hello");
    expect(await p.getMessages(chat.id)).toHaveLength(2);
    // Ordering is the transcript's; seq starts at 1 and counts within the chat.
    expect([user.seq, assistant.seq]).toEqual([1, 2]);
  });

  it("omits what it cannot honestly do", () => {
    const p = store();
    expect(p.subscribeMessages).toBeUndefined();
    expect(p.markChatRead).toBeUndefined();
    expect(p.requestAgentReply).toBeUndefined();
    expect(p.signedUploadUrl).toBeUndefined();
  });

  it("says a summary needs an account instead of inventing one", async () => {
    const p = store();
    const chat = await p.createChat({});
    // An empty-string summary would render as a successful, blank summary.
    expect(await p.summarizeChat(chat.id)).toEqual({ error: "needs an account" });
  });

  it("keeps chats and their messages apart", async () => {
    const p = store();
    const a = await p.createChat({ title: "A" });
    const b = await p.createChat({ title: "B" });
    await p.sendMessages(a.id, [{ role: "user", content: "in A" }]);

    expect(a.id).not.toBe(b.id);
    expect(await p.getMessages(b.id)).toEqual([]);
    expect((await p.getMessages(a.id))[0].content).toBe("in A");
    // A message id must not collide with a chat id the loop is holding.
    const [m] = await p.sendMessages(b.id, [{ role: "user", content: "in B" }]);
    expect(m.id).not.toBe(b.id);
    expect(m.seq).toBe(1);
  });

  it("returns the most recent N in chronological order when limited", async () => {
    const p = store();
    const chat = await p.createChat({});
    for (const c of ["one", "two", "three"]) await p.sendMessages(chat.id, [{ role: "user", content: c }]);
    expect((await p.getMessages(chat.id, 2)).map((m) => m.content)).toEqual(["two", "three"]);
  });

  it("lists newest first, and a send moves its chat to the top", async () => {
    const p = store();
    const first = await p.createChat({ title: "first" });
    await p.createChat({ title: "second" });
    expect((await p.listChats()).map((c) => c.title)).toEqual(["second", "first"]);

    await p.sendMessages(first.id, [{ role: "user", content: "bump" }]);
    expect((await p.listChats())[0].title).toBe("first");
  });

  it("filters the list by project", async () => {
    const p = store();
    await p.createChat({ title: "loose", projectId: null });
    await p.createChat({ title: "owned", projectId: 7 });
    expect((await p.listChats({ projectId: "7" })).map((c) => c.title)).toEqual(["owned"]);
  });

  it("renames and re-parents a chat", async () => {
    const p = store();
    const chat = await p.createChat({ title: "New chat" });
    const renamed = await p.updateChat(chat.id, { title: "Renamed", projectId: 3 });
    expect(renamed.title).toBe("Renamed");
    expect(renamed.projectId).toBe(3);
    expect((await p.getChat(chat.id)).title).toBe("Renamed");
  });

  it("drops a deleted chat's messages with it", async () => {
    const p = store();
    const chat = await p.createChat({});
    await p.sendMessages(chat.id, [{ role: "user", content: "x" }]);
    await p.deleteChat(chat.id);
    expect(await p.listChats()).toEqual([]);
    await expect(p.getChat(chat.id)).rejects.toThrow(/No such chat/);
  });

  it("reports a send to a chat it does not have, rather than swallowing it", async () => {
    // Silently accepting would strand the turn: the loop would stream a reply into a
    // conversation that does not exist.
    await expect(store().sendMessages(999, [{ role: "user", content: "x" }])).rejects.toThrow(/No such chat/);
  });

  it("accepts a thumb without throwing mid-transcript", async () => {
    await expect(store().setMessageFeedback(1, "up")).resolves.toBeDefined();
  });

  it("returns an empty url for an attachment it never took", () => {
    expect(store().uploadUrl("never-uploaded")).toBe("");
  });
});

/**
 * The store above is only a fix if the panel actually reaches for it. The original bug
 * was entirely in this wiring — every unit was correct — so the wiring is asserted at
 * source level, the same way `modelRouting.test.ts` guards the routing seam.
 */
describe("the panel is wired to it", () => {
  const app = readFileSync(join(__dirname, "App.tsx"), "utf8");

  it("uses the session store when signed out and the gateway when signed in", () => {
    expect(app).toContain("createInMemoryPersistence");
    // The branch, not merely the import: a dead import would satisfy the line above.
    expect(app).toMatch(/persistence:\s*signedOut/);
    expect(app).toContain("createPersistence(init.baseUrl, getToken");
  });

  it("recomputes the runtime when the account state changes", () => {
    // Without `signedOut` in the deps, signing in mid-session leaves the panel writing
    // to the session store and never persisting the conversation.
    // Anchored on `init.grounding` so it identifies the RUNTIME memo specifically —
    // other memos in this file also open with `init.baseUrl`.
    const deps = app.match(/\[init\.baseUrl,[^\]]*init\.grounding[^\]]*\]/);
    expect(deps?.[0]).toContain("signedOut");
  });

  it("keeps one store per panel rather than one per render", () => {
    // A store rebuilt inside the memo would drop the conversation on any re-render.
    expect(app).toContain("useRef<BrainPersistenceAdapter | null>(null)");
  });
});
