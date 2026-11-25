import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { commitGateRefusal, pushGateRefusal, repoRelative, sweptScratchScripts, type GateDeps, type GitRunner } from "./publishGate";

/** The real commit VS Code chat #275 pushed (`git show c9c043248 -- frontend/scripts/.react-hooks-baseline.txt`). */
const C9C043248 = readFileSync(path.resolve(__dirname, "../../../packages/run-guards/src/__fixtures__/c9c043248-react-hooks-baseline.diff"), "utf8");
const DIFF_ONLY = C9C043248.slice(C9C043248.indexOf("diff --git"));
const BASELINE = "frontend/scripts/.react-hooks-baseline.txt";
const ROOT = path.resolve("/repo");

/** A git that answers by the first word(s) of its arguments, recording every call. */
function fakeGit(answers: Record<string, string | undefined>): GitRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (args: string) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.startsWith(k));
    return key === undefined ? undefined : answers[key];
  }) as GitRunner & { calls: string[] };
  run.calls = calls;
  return run;
}

function deps(files: Record<string, string> = {}) {
  const warn = vi.fn<(message: string) => void>();
  const d: GateDeps = { readFile: async (p) => files[path.resolve(p)], warn };
  return Object.assign(d, { warn });
}

const repo = (extra: Record<string, string | undefined>) => fakeGit({ "rev-parse --show-toplevel": `${ROOT}\n`, "ls-files": "", ...extra });

describe("commitGateRefusal", () => {
  it("refuses c9c043248's baseline raise without a baseline-raise trailer", async () => {
    const git = repo({ "diff --name-only": `${BASELINE}\n`, "diff -U": DIFF_ONLY });
    const refusal = await commitGateRefusal(git, ROOT, { message: "Record react-hooks ratchet improvement", paths: [BASELINE] }, deps());
    expect(refusal).toContain("src/app/personas/PersonasClient.tsx 1 → 2");
    expect(refusal).toContain("baseline-raise:");
    // Only the baseline file is diffed, with full context.
    expect(git.calls.find((c) => c.startsWith("diff -U"))).toContain(`":(top)${BASELINE}"`);
  });

  it("lets an owned raise through, and a commit that touches no baseline", async () => {
    const message = "Split panel\n\nbaseline-raise: RunScanPanel's 3 warnings moved with the file";
    expect(await commitGateRefusal(repo({ "diff --name-only": `${BASELINE}\n`, "diff -U": DIFF_ONLY }), ROOT, { message, paths: [BASELINE] }, deps())).toBeNull();
    const git = repo({ "diff --name-only": "frontend/src/a.tsx\n" });
    expect(await commitGateRefusal(git, ROOT, { message: "fix", paths: ["frontend/src/a.tsx"] }, deps())).toBeNull();
    expect(git.calls.some((c) => c.startsWith("diff -U"))).toBe(false);
  });

  it("reads a NEW untracked baseline file as added entries", async () => {
    const file = "api/scripts/.new-baseline.txt";
    const git = repo({ "ls-files": `${file}\n`, "diff --name-only": "" });
    const refusal = await commitGateRefusal(git, ROOT, { message: "add guard", paths: ["api/scripts"] }, deps({ [path.join(ROOT, file)]: "# header\napplication/a.ts:2\n" }));
    expect(refusal).toContain("application/a.ts");
  });

  it("refuses a directory commit that would sweep an unnamed scratch script", async () => {
    const git = repo({ "ls-files": "frontend/src/_split.cjs\nfrontend/src/components/Real.tsx\n", "diff --name-only": "" });
    const refusal = await commitGateRefusal(git, ROOT, { message: "extract", paths: ["frontend/src"] }, deps());
    expect(refusal).toContain("frontend/src/_split.cjs");
    expect(refusal).toContain("$BF_SCRATCH_DIR");
    expect(refusal).not.toContain("Real.tsx");
  });

  it("accepts a scratch-named file named exactly — absolute, or relative to a subdirectory", async () => {
    const file = "tools/_bootstrap.mjs";
    for (const [cwd, named] of [[ROOT, path.join(ROOT, file)], [path.join(ROOT, "tools"), "_bootstrap.mjs"], [ROOT, file]] as const) {
      const git = repo({ "ls-files": `${file}\n`, "diff --name-only": "" });
      expect(await commitGateRefusal(git, cwd, { message: "add bootstrap", paths: [named] }, deps()), named).toBeNull();
    }
    expect(repoRelative(ROOT, path.join(ROOT, "tools"), "../a/b.ts")).toBe("a/b.ts");
    expect(sweptScratchScripts(["tools/_notes.md", "tools/x_y.ts"], ["tools"])).toEqual([]);
  });

  it("never refuses a real underscore-named project file swept by a directory commit", async () => {
    const git = repo({ "ls-files": "public/_worker.js\npages/_app.ts\n", "diff --name-only": "" });
    expect(await commitGateRefusal(git, ROOT, { message: "deploy worker", paths: ["public", "pages"] }, deps())).toBeNull();
    expect(sweptScratchScripts(["public/_worker.js", "pages/_app.ts", "tools/_probe.mjs"], ["public", "pages", "tools"])).toEqual(["tools/_probe.mjs"]);
  });

  it("fails open with a warning outside a repository", async () => {
    const d = deps();
    expect(await commitGateRefusal(fakeGit({}), ROOT, { message: "x", paths: ["a.ts"] }, d)).toBeNull();
    expect(d.warn).toHaveBeenCalledTimes(1);
  });
});

describe("pushGateRefusal", () => {
  const unpushed = (log: string) => fakeGit({
    "rev-parse --abbrev-ref --symbolic-full-name": "origin/main\n",
    "rev-list": "c9c043248d5ef36093a27a15498304602134d0ee\n",
    "log -1": log,
    "show --name-only": `${BASELINE}\n`,
    "show --format=": DIFF_ONLY,
  });

  it("refuses an unpushed commit that raised a baseline without owning it — merges excluded", async () => {
    const git = unpushed("Record react-hooks ratchet improvement for IncidentsPageClient\n");
    const refusal = await pushGateRefusal(git, undefined, deps());
    expect(refusal).toContain("c9c043248 Record react-hooks ratchet improvement");
    expect(refusal).toContain("src/components/governance/RunScanPanel.tsx");
    // A merge's combined diff is not a unified one: merges are never listed.
    expect(git.calls.find((c) => c.startsWith("rev-list"))).toContain("--no-merges");
  });

  it("passes owned raises, and warns when there is nothing to judge against", async () => {
    expect(await pushGateRefusal(unpushed("Move\n\nbaseline-raise: moved file\n"), undefined, deps())).toBeNull();
    const d = deps();
    expect(await pushGateRefusal(fakeGit({}), "ticket/1", d)).toBeNull();
    expect(d.warn).toHaveBeenCalledTimes(1);
  });
});

describe("commitGateRefusal: app manifests", () => {
  const MANIFEST = ".builderforce/builderforce.json";
  const files = (text: string) => ({ [path.resolve(ROOT, MANIFEST)]: text });

  it("refuses a staged manifest the runtime's parser rejects, naming it", async () => {
    const refusal = await commitGateRefusal(repo({}), ROOT, { message: "Add manifest", paths: [MANIFEST] }, deps(files("{ nope")));
    expect(refusal).toContain(`Refused: ${MANIFEST} is not a valid app manifest`);
  });

  it("lets a valid manifest, and a deleted one, through", async () => {
    const valid = JSON.stringify({ version: 1, name: "demo", services: { web: { runtime: "node", command: "node server.js", port: 3000, role: "frontend", readiness: { http: "/" } } } });
    expect(await commitGateRefusal(repo({ "diff --name-only": "" }), ROOT, { message: "Add manifest", paths: [MANIFEST] }, deps(files(valid)))).toBeNull();
    expect(await commitGateRefusal(repo({ "diff --name-only": "" }), ROOT, { message: "Remove manifest", paths: [MANIFEST] }, deps())).toBeNull();
  });
});
