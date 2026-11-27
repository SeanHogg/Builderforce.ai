import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ on: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: (async (...args: Parameters<typeof actual.realpath>) => {
      if (failure.on) throw Object.assign(new Error(`EACCES: permission denied, realpath '${String(args[0])}'`), { code: "EACCES" });
      return actual.realpath(...args);
    }) as typeof actual.realpath,
  };
});

import { PathUnverifiableError, resolveInsideRootRealOrThrow, tryResolveInsideRootReal } from "./node-path.js";

let dir: string | undefined;
afterEach(async () => {
  failure.on = false;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("tryResolveInsideRootReal when the filesystem refuses", () => {
  it("returns a typed failure naming only the root-relative path, never the host path", async () => {
    dir = await mkdtemp(join(tmpdir(), "bf-unverifiable-"));
    failure.on = true;
    const out = await tryResolveInsideRootReal(dir, "src/a.ts");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("unverifiable");
    expect(out.error).toBe("'src/a.ts' could not be verified inside the workspace (EACCES)");
    expect(out.error).not.toContain(dir);
  });

  it("still reports an escape as `escapes`, and an inside path as ok", async () => {
    dir = await mkdtemp(join(tmpdir(), "bf-unverifiable-"));
    expect(await tryResolveInsideRootReal(dir, "../x")).toMatchObject({ ok: false, reason: "escapes" });
    expect(await tryResolveInsideRootReal(dir, "a.ts")).toEqual({ ok: true, abs: join(dir, "a.ts") });
  });

  it("the throwing form raises a host-path-free PathUnverifiableError", async () => {
    dir = await mkdtemp(join(tmpdir(), "bf-unverifiable-"));
    failure.on = true;
    const err = await resolveInsideRootRealOrThrow(dir, "a.ts").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PathUnverifiableError);
    expect((err as Error).message).not.toContain(dir);
  });
});
