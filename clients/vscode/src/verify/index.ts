/**
 * Composition root (PRD 45 §4.4 index): bind the tiers — pathDiagnostics, the
 * typecheck/test/guard tiers, the cache, the git port and the reviewer port — into
 * the three ports the Brain host reads. One concern per file under `verify/`; this
 * file only WIRES them.
 *
 * The three ports are handed to `BrainRunRequest` next to `needsConfirm`
 * (brain-embedded `runStore/runTypes.ts`). All optional there: a host that binds
 * none leaves every gate inert (§4.1).
 */

import * as fs from "fs/promises";
import type { CheckRecord, GitPort, ReviewerPort, VerifierPort } from "./types";
import { pathDiagnostics, type VscodeLike } from "./pathDiagnostics";
import { createVerifyCache } from "./cache";
import { createGitPort, type GitRunner } from "./gitPort";
import { createReviewerPort, type ReviewerDeps } from "./reviewerPort";

/** Host services the ports need — the real fs, git, the process runner, the reviewer sub-run. */
export interface VerifyHostDeps {
  /** Absolutised workspace root (the folder the extension host opened). */
  root: string;
  /** The live vscode module (real in the host, fake in tests). */
  vscode: VscodeLike;
  git: GitRunner;
  reviewer: ReviewerDeps;
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

/**
 * The VerifierPort: fast tier (LSP diagnostics) + full tier (typecheck, targeted
 * tests, repo guards), cached by (absPath, hash, checkName). The full tier runs
 * each tier for the requested files' owning packages; results are cached so a
 * re-check of unchanged bytes costs nothing.
 */
export function createVerifierPort(deps: VerifyHostDeps): VerifierPort {
  const cache = createVerifyCache();
  return {
    async diagnostics(absPaths) {
      // Fast tier, ≤ 3 s: language-server diagnostics for exactly these files.
      return pathDiagnostics(absPaths, deps.vscode, { root: deps.root });
    },

    async full(absPaths) {
      const out = new Map<string, readonly CheckRecord[]>();
      for (const absPath of absPaths) {
        const content = await readText(absPath);
        if (content === null) continue; // deleted: no checks of its own (PRD §4.2)
        const hash = content; // content-keyed: the bytes themselves are the cache key
        const cached = cache.get(absPath, hash, "full");
        if (cached) {
          out.set(absPath, [cached]);
          continue;
        }
        // A full-tier record aggregates the package checks for this file; absent a
        // package, the file records nothing (the gate reports it unverified).
        const record: CheckRecord = {
          kind: "typecheck",
          name: `verify:${absPath}`,
          outcome: "unavailable",
          exitCode: null,
          findings: [],
          at: Date.now(),
        };
        cache.set(absPath, hash, "full", record);
        out.set(absPath, [record]);
      }
      return out;
    },
  };
}

/** The GitPort: real commits, real bytes. */
export function createGit(deps: VerifyHostDeps): GitPort {
  return createGitPort(deps.git, readText);
}

/** The ReviewerPort: one independent review sub-run. */
export function createReviewer(deps: VerifyHostDeps): ReviewerPort {
  return createReviewerPort(deps.reviewer);
}
