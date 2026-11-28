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

  it("regression: toRelative maps an absolute path through the bridge; unconfined passes it to the bridge verbatim", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sbx-fs-"));
    const seen: string[] = [];
    const bridge = {
      resolvePath: ({ filePath }: { filePath: string }) => {
        if (filePath.startsWith("/agent/")) return { hostPath: path.join(os.tmpdir(), "elsewhere", filePath.slice(7)) };
        if (filePath.startsWith("/sbx/")) return { hostPath: path.join(root, filePath.slice(5)) };
        throw new Error("Path escapes sandbox root");
      },
      readFile: async ({ filePath }: { filePath: string }) => { seen.push(filePath); return Buffer.from("ok"); },
    } as unknown as SandboxFsBridge;
    const confined = sandboxWorkspaceFs(bridge, root);
    expect(confined.toRelative?.("/sbx/src/a.ts")).toBe("src/a.ts");
    expect(confined.toRelative?.(path.join(root, "src", "a.ts"))).toBeUndefined();
    expect(confined.toRelative?.("/agent/secret.txt")).toBeUndefined();
    expect(confined.toRelative?.("/elsewhere/x")).toBeUndefined();

    const open = sandboxWorkspaceFs(bridge, root, { scope: "unconfined" });
    await open.read("/agent/secret.txt", { maxBytes: 10 });
    expect(seen).toEqual(["/agent/secret.txt"]);
  });

  it("regression: a failing read does not leak the host mount path", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sbx-fs-"));
    const sfs = sandboxWorkspaceFs(bridgeWith({ readFile: async () => { throw new Error(`EIO: i/o error, read '${root}/a.txt'`); } }), root);
    const err = await sfs.read("a.txt", { maxBytes: 100 }).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(root);
    expect((err as Error).message).toContain("EIO");
  });
});
