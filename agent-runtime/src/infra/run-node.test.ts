import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-run-node-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("run-node script", () => {
  it.runIf(process.platform !== "win32")(
    "builds with tsdown (clean) so chunk references stay consistent",
    async () => {
      await withTempDir(async (tmp) => {
        const argsPath = path.join(tmp, ".pnpm-args.txt");

        const nodeCalls: string[][] = [];
        const spawn = (cmd: string, args: string[]) => {
          if (cmd === "pnpm") {
            void fs.writeFile(argsPath, args.join(" "), "utf-8");
          }
          if (cmd === process.execPath) {
            nodeCalls.push([cmd, ...args]);
          }
          return {
            on: (event: string, cb: (code: number | null, signal: string | null) => void) => {
              if (event === "exit") {
                queueMicrotask(() => cb(0, null));
              }
              return undefined;
            },
          };
        };

        const { runNodeMain } = await import("../../scripts/run-node.mjs");
        const exitCode = await runNodeMain({
          cwd: tmp,
          args: ["--version"],
          env: {
            ...process.env,
            BUILDERFORCE_AGENTS_FORCE_BUILD: "1",
            BUILDERFORCE_AGENTS_RUNNER_LOG: "0",
          },
          spawn,
          execPath: process.execPath,
          platform: process.platform,
        });

        expect(exitCode).toBe(0);
        await expect(fs.readFile(argsPath, "utf-8")).resolves.toContain("exec tsdown");
        expect(nodeCalls).toEqual([[process.execPath, "builderforce.mjs", "--version"]]);
      });
    },
  );
});
