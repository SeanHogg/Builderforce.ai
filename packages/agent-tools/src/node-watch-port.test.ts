import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeWatchPort } from "./node-watch-port.js";
import { WorkspaceSymbolIndex } from "./node-symbols.js";
import type { WatchPort } from "./watch-port.js";

describe("nodeWatchPort", () => {
  let tmp = "";
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("regression: a root opened through a symlink receives events re-based under ITS root", async () => {
    tmp = await mkdtemp(join(tmpdir(), "watch-port-"));
    const real = join(tmp, "real");
    const link = join(tmp, "link");
    await mkdir(real);
    try {
      await symlink(real, link, "junction");
    } catch {
      return; // the host cannot create links: nothing to prove here
    }
    const seen: string[] = [];
    const unsubscribe = nodeWatchPort().subscribe(link, (paths) => seen.push(...paths));
    try {
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(join(real, "a.ts"), "export const a = 1;\n");
      const deadline = Date.now() + 4000;
      while (!seen.some((p) => p.endsWith("a.ts")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    } finally {
      unsubscribe();
    }
    const hit = seen.find((p) => p.endsWith("a.ts"));
    expect(hit).toBe(join(link, "a.ts"));
  });
});

describe("WorkspaceSymbolIndex change feed", () => {
  let tmp = "";
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("regression: a root-level event (the feed cannot vouch for the tree) triggers a full refresh", async () => {
    tmp = await mkdtemp(join(tmpdir(), "watch-root-"));
    await writeFile(join(tmp, "one.ts"), "export function alpha() {}\n");
    let deliver: (paths: string[]) => void = () => undefined;
    const port: WatchPort = {
      subscribe(_root, onChange) {
        deliver = onChange;
        return () => undefined;
      },
    };
    const index = new WorkspaceSymbolIndex(tmp, {});
    index.follow(port);
    const first = await index.find("alpha");
    expect(first.ok && first.total).toBe(1);

    await writeFile(join(tmp, "two.ts"), "export function beta() {}\n");
    expect((await index.find("beta")).ok && (await index.find("beta") as { total: number }).total).toBe(0); // no event yet: still warm

    deliver([tmp]);
    const after = await index.find("beta");
    expect(after.ok && after.total).toBe(1);
  });
});
