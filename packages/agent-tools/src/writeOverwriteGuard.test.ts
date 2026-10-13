import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider } from "./capabilities.js";
import { buildCoreToolRegistry } from "./core-tools.js";
import type { ToolContext } from "./tool.js";
import {
  probeFromRepoRead,
  refuseWriteOverwrite,
  utf8ByteLength,
  WRITE_OVERWRITE_LARGE_BYTES,
} from "./writeOverwriteGuard.js";

describe("probeFromRepoRead", () => {
  it("treats not-found as a missing file (create still allowed)", () => {
    expect(probeFromRepoRead({ ok: false, error: "file not found on main: NEW.md" })).toEqual({
      status: "missing",
    });
    expect(probeFromRepoRead({ ok: false, error: "ENOENT: no such file or directory" })).toEqual({
      status: "missing",
    });
    expect(probeFromRepoRead({ ok: false, error: "GitHub 404: Not Found" })).toEqual({ status: "missing" });
  });

  it("treats any other failed read as unreadable, including 'no repository bound'", () => {
    const probe = probeFromRepoRead({
      ok: false,
      error: "no repository bound to this task; include the file contents in your final summary instead",
    });
    expect(probe.status).toBe("unreadable");
  });

  it("does not treat an empty successful read as an empty file", () => {
    const probe = probeFromRepoRead({ ok: true, path: "DONE.md", content: "" });
    expect(probe.status).toBe("unreadable");
  });

  it("allows a confirmed empty file (totalLines 0)", () => {
    expect(probeFromRepoRead({ ok: true, path: "empty.txt", content: "", totalLines: 0 })).toEqual({
      status: "ok",
      bytes: 0,
    });
  });

  it("estimates size from totalLines when the read is truncated", () => {
    const window = "line\n".repeat(10);
    const probe = probeFromRepoRead({
      ok: true,
      path: "DONE.md",
      content: window,
      truncated: true,
      totalLines: 34118,
    });
    expect(probe.status).toBe("ok");
    if (probe.status === "ok") {
      expect(probe.truncated).toBe(true);
      expect(probe.bytes).toBeGreaterThan(WRITE_OVERWRITE_LARGE_BYTES);
    }
  });

  it("refuses a truncated read with no totalLines", () => {
    const probe = probeFromRepoRead({
      ok: true,
      path: "DONE.md",
      content: "partial",
      truncated: true,
    });
    expect(probe.status).toBe("unreadable");
  });
});

describe("refuseWriteOverwrite", () => {
  it("allows creating a missing file", () => {
    expect(refuseWriteOverwrite({ status: "missing" }, "hello")).toBeNull();
  });

  it("hard-stops an unreadable existing path", () => {
    const msg = refuseWriteOverwrite({ status: "unreadable", reason: "no repository bound" }, "x");
    expect(msg).toMatch(/cannot overwrite/);
    expect(msg).toMatch(/failed or empty read is not an empty file/);
  });

  it("refuses replacing a large file with a much smaller body", () => {
    const existing = "x".repeat(WRITE_OVERWRITE_LARGE_BYTES * 2);
    const msg = refuseWriteOverwrite({ status: "ok", bytes: utf8ByteLength(existing) }, "tiny\n");
    expect(msg).toMatch(/refusing to replace a large existing file/);
    expect(msg).toMatch(/edit_file/);
  });

  it("allows a similarly-sized rewrite of a large file", () => {
    const existing = "x".repeat(WRITE_OVERWRITE_LARGE_BYTES * 2);
    const incoming = "y".repeat(WRITE_OVERWRITE_LARGE_BYTES * 2);
    expect(refuseWriteOverwrite({ status: "ok", bytes: utf8ByteLength(existing) }, incoming)).toBeNull();
  });

  it("allows rewriting a small file even when the new body is tiny", () => {
    expect(refuseWriteOverwrite({ status: "ok", bytes: 80 }, "x")).toBeNull();
  });
});

function providerForWrite(opts: {
  read: CapabilityProvider["repoRead"];
  writeFile?: CapabilityProvider["repoWrite"] extends infer W
    ? W extends { writeFile: infer F } ? F : never
    : never;
}): CapabilityProvider {
  let wrote = false;
  return {
    capabilities: new Set<Capability>(["repo.read", "repo.write"]),
    repoRead: opts.read,
    repoWrite: {
      writeFile: async (path, content) => {
        wrote = true;
        if (opts.writeFile) return opts.writeFile(path, content);
        return { ok: true, change: "created" as const };
      },
      deleteFile: async () => ({ ok: true, deleted: true }),
      editFile: async () => ({ ok: true, change: "modified" as const, replaced: 1 }),
    },
    didWrite: () => wrote,
  } as CapabilityProvider & { didWrite: () => boolean };
}

describe("write_file tool hard stop", () => {
  const registry = buildCoreToolRegistry();

  it("does not write when the existing file cannot be read", async () => {
    let wrote = false;
    const caps = providerForWrite({
      read: {
        listFiles: async () => ({ ok: true, paths: [] }),
        readFile: async () => ({ ok: false, error: "no repository bound to this task" }),
        searchCode: async (query) => ({ ok: true, query, total: 0, matches: [] }),
      },
      writeFile: async () => {
        wrote = true;
        return { ok: true, change: "modified" };
      },
    });
    const ctx: ToolContext = { caps, workspaceRoot: "/repo" };
    const r = await registry.dispatch("write_file", { path: "DONE.md", content: "# oops\n" }, ctx);
    expect(r.data.ok).toBe(false);
    expect(String(r.data.error)).toMatch(/cannot overwrite/);
    expect(wrote).toBe(false);
  });

  it("does not write when a successful read comes back empty", async () => {
    let wrote = false;
    const caps = providerForWrite({
      read: {
        listFiles: async () => ({ ok: true, paths: ["DONE.md"] }),
        readFile: async () => ({ ok: true, path: "DONE.md", content: "" }),
        searchCode: async (query) => ({ ok: true, query, total: 0, matches: [] }),
      },
      writeFile: async () => {
        wrote = true;
        return { ok: true, change: "modified" };
      },
    });
    const r = await registry.dispatch(
      "write_file",
      { path: "DONE.md", content: "# oops\n" },
      { caps, workspaceRoot: "/repo" },
    );
    expect(r.data.ok).toBe(false);
    expect(String(r.data.error)).toMatch(/empty/);
    expect(wrote).toBe(false);
  });

  it("refuses shrinking a large existing file", async () => {
    let wrote = false;
    const large = "line\n".repeat(800);
    const caps = providerForWrite({
      read: {
        listFiles: async () => ({ ok: true, paths: ["DONE.md"] }),
        readFile: async () => ({ ok: true, path: "DONE.md", content: large }),
        searchCode: async (query) => ({ ok: true, query, total: 0, matches: [] }),
      },
      writeFile: async () => {
        wrote = true;
        return { ok: true, change: "modified" };
      },
    });
    const r = await registry.dispatch(
      "write_file",
      { path: "DONE.md", content: "# tiny\n" },
      { caps, workspaceRoot: "/repo" },
    );
    expect(r.data.ok).toBe(false);
    expect(String(r.data.error)).toMatch(/edit_file/);
    expect(wrote).toBe(false);
  });

  it("still creates a new file when the read is not-found", async () => {
    let wrotePath: string | null = null;
    const caps = providerForWrite({
      read: {
        listFiles: async () => ({ ok: true, paths: [] }),
        readFile: async () => ({ ok: false, error: "file not found on main: NEW.md" }),
        searchCode: async (query) => ({ ok: true, query, total: 0, matches: [] }),
      },
      writeFile: async (path) => {
        wrotePath = path;
        return { ok: true, change: "created" };
      },
    });
    const r = await registry.dispatch(
      "write_file",
      { path: "NEW.md", content: "hello\n" },
      { caps, workspaceRoot: "/repo" },
    );
    expect(r.data.ok).toBe(true);
    expect(wrotePath).toBe("NEW.md");
  });
});
