import { describe, expect, it, vi } from "vitest";
import { createNativeProjectAdopter } from "./nativeChatProject";

/**
 * The native participant binds the IDE's selected project onto a chat that has none, so
 * the server's learn gate (keyed on the chat's project) lets its turns train that
 * project's Evermind. The rule matches the webview's (`adoptChatProject`, `useChatMemory`).
 */
function setup(chatProjectId: number | null = null) {
  const persistence = {
    getChat: vi.fn(async (id: number) => ({ id, title: "t", projectId: chatProjectId, createdAt: "", updatedAt: "" })),
    updateChat: vi.fn(async (id: number, body: { projectId?: number | null }) => ({ id, title: "t", projectId: body.projectId ?? null, createdAt: "", updatedAt: "" })),
  };
  const bindServerProject = vi.fn(async () => true);
  const adopt = createNativeProjectAdopter();
  const run = (over: { chatId?: number; serverChatId?: number | null; projectId?: number | null } = {}) =>
    adopt({
      persistence: persistence as never,
      bindServerProject,
      chatId: over.chatId ?? 7,
      serverChatId: "serverChatId" in over ? over.serverChatId : 900,
      projectId: "projectId" in over ? over.projectId : 30,
    });
  return { persistence, bindServerProject, run };
}

describe("native chat project adoption", () => {
  it("binds the selected project onto an unattached chat, server first then local", async () => {
    const t = setup(null);
    await expect(t.run()).resolves.toBe("adopted");
    expect(t.bindServerProject).toHaveBeenCalledWith(900, 30);
    expect(t.persistence.updateChat).toHaveBeenCalledWith(7, { projectId: 30 });
  });

  it("does nothing with no project selected: the chat stays global", async () => {
    const t = setup(null);
    await expect(t.run({ projectId: null })).resolves.toBe("no-project");
    expect(t.bindServerProject).not.toHaveBeenCalled();
    expect(t.persistence.getChat).not.toHaveBeenCalled();
    expect(t.persistence.updateChat).not.toHaveBeenCalled();
  });

  it("never re-points a chat that is already attached", async () => {
    const t = setup(12);
    await expect(t.run()).resolves.toBe("already-scoped");
    expect(t.bindServerProject).not.toHaveBeenCalled();
    expect(t.persistence.updateChat).not.toHaveBeenCalled();
  });

  it("adopts at most once per chat", async () => {
    const t = setup(null);
    await t.run();
    await expect(t.run()).resolves.toBe("already-attempted");
    expect(t.bindServerProject).toHaveBeenCalledTimes(1);
    // A different chat is its own attempt.
    await expect(t.run({ chatId: 8 })).resolves.toBe("adopted");
    expect(t.bindServerProject).toHaveBeenCalledTimes(2);
  });

  it("releases a failed attempt so a later turn retries, and leaves the local record unclaimed", async () => {
    const t = setup(null);
    t.bindServerProject.mockResolvedValueOnce(false);
    await expect(t.run()).resolves.toBe("failed");
    expect(t.persistence.updateChat).not.toHaveBeenCalled();
    await expect(t.run()).resolves.toBe("adopted");
  });

  it("scopes only the local record when the chat is not bound to a server chat", async () => {
    const t = setup(null);
    await expect(t.run({ serverChatId: null })).resolves.toBe("adopted");
    expect(t.bindServerProject).not.toHaveBeenCalled();
    expect(t.persistence.updateChat).toHaveBeenCalledWith(7, { projectId: 30 });
  });
});
