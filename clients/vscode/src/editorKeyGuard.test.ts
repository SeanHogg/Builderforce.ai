import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stored: "bfk_current" as string | undefined,
  drop: vi.fn(),
  warn: vi.fn(async () => undefined),
}));

vi.mock("vscode", () => ({
  Disposable: { from: (...items: Array<{ dispose(): unknown }>) => ({ dispose: () => items.forEach((i) => i.dispose()) }) },
  l10n: { t: (s: string) => s },
  window: { showWarningMessage: h.warn },
  commands: { executeCommand: vi.fn() },
}));
vi.mock("./bfApi", () => ({
  onEditorKeyRejected: () => ({ dispose: () => undefined }),
  dropWorkspaceSelection: h.drop,
}));
vi.mock("./gateway", () => ({ SECRET_KEY: "k" }));

import { watchRejectedEditorKey } from "./editorKeyGuard";
import { observeGatewayResponse } from "./gatewayAuth";

const refuse = async (code: string, key: string, workspace = 7) => {
  observeGatewayResponse(new Response(JSON.stringify({ code }), { status: 403 }), {
    authorization: `Bearer ${key}`,
    "x-builderforce-workspace": String(workspace),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("workspace refusals", () => {
  const signOut = vi.fn(async () => undefined);
  let guard: { dispose(): unknown };

  beforeEach(() => {
    h.stored = "bfk_current";
    h.drop.mockClear();
    h.warn.mockClear();
    signOut.mockClear();
    guard?.dispose();
    guard = watchRejectedEditorKey({ get: async () => h.stored } as never, signOut);
  });

  it("workspace_not_member drops the selection and does NOT sign out", async () => {
    await refuse("workspace_not_member", "bfk_current");
    expect(h.drop).toHaveBeenCalledWith(7); // only the workspace the refusal was ABOUT
    expect(signOut).not.toHaveBeenCalled();
  });

  it("editor_key_required signs out and prompts, once per key", async () => {
    await refuse("editor_key_required", "bfk_current");
    await refuse("editor_key_required", "bfk_current");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.drop).not.toHaveBeenCalled();
  });

  it("ignores a refusal that answered a key that is no longer the stored one", async () => {
    await refuse("editor_key_required", "bfk_previous");
    await refuse("workspace_not_member", "bfk_previous");
    expect(signOut).not.toHaveBeenCalled();
    expect(h.drop).not.toHaveBeenCalled();
  });
});
