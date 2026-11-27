import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceError } from "@builderforce/agent-tools/workspace";
import type { SandboxFsBridge } from "./fs-bridge.js";
import { sandboxWorkspaceFs } from "./sandboxWorkspaceFs.js";

function bridgeWith(overrides: Partial<Record<"stat" | "readFile" | "remove", (...a: never[]) => Promise<unknown>>>): SandboxFsBridge {
  return {
    stat: async () => ({}),
    readFile: async () => Buffer.from(""),
    remove: async () => undefined,
    writeFile: async () => undefined,
    ...overrides,
  } as unknown as SandboxFsBridge;
}

describe("sandboxWorkspaceFs errors", () => {
  let root = "";
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = "";
  });

  it("regression: remove reports 'missing' only for a not-found stat; other stat errors are rethrown scrubbed", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sbx-fs-"));
    const notFound = sandboxWorkspaceFs(bridgeWith({ stat: async () => { throw new Error("stat: No such file or directory"); } }), root);
    expect(await notFound.remove("a.txt")).toBe("missing");

    const denied = sandboxWorkspaceFs(bridgeWith({ stat: async () => { throw new Error(`EACCES: permission denied, stat '${root}/a.txt'`); } }), root);
    const err = await denied.remove("a.txt").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceError);
    expect((err as Error).message).not.toContain(root);
    expect((err as Error).message).toContain("EACCES");
  });

  it("regression: a failing read does not leak the host mount path", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sbx-fs-"));
    const sfs = sandboxWorkspaceFs(bridgeWith({ readFile: async () => { throw new Error(`EIO: i/o error, read '${root}/a.txt'`); } }), root);
    const err = await sfs.read("a.txt", { maxBytes: 100 }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(root);
    expect((err as Error).message).toContain("EIO");
  });
});
