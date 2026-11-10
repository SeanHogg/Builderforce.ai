/**
 * Composition root (PRD 45 §4.4 index): bind the tiers — pathDiagnostics, the full tier
 * (typecheck / targeted tests / repo guards, `fullTier.ts`), the cache, the git port and the
 * reviewer port — into the three ports the Brain host reads. One concern per file under
 * `verify/`; this file only WIRES them.
 *
 * The three ports are handed to `BrainRunRequest` next to `needsConfirm`
 * (brain-embedded `runStore/runTypes.ts`) by `editorShipPorts.ts`. All optional there: a host
 * that binds none leaves every gate inert (§4.1).
 *
 * Paths: the Brain hands over what the model wrote — `edit_file` paths are WORKSPACE-RELATIVE,
 * and a git tool with no `repo` sends `""`. Both are resolved against the workspace root here,
 * once, so every tier below sees absolute paths.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { CheckRecord, GitPort, ReviewerPort, VerifierPort } from "./types";
import { pathDiagnostics, type VscodeLike } from "./pathDiagnostics";
import { createVerifyCache } from "./cache";
import { runFullTier } from "./fullTier";
import { createGitPort, type GitRunner } from "./gitPort";
import { createReviewerPort, type ReviewerDeps } from "./reviewerPort";

/** Host services the verifier and git ports need — the editor, the real fs, git. */
export interface VerifyHostDeps {
  /** Absolutised workspace root (the folder the extension host opened). */
  root: string;
  /** The live vscode module (real in the host, fake in tests). */
  vscode: VscodeLike;
  git: GitRunner;
  /** The file reader (default: the real fs, UTF-8; null when absent). */
  readText?: (abs: string) => Promise<string | null>;
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

/** A path the model named, absolute: workspace-relative paths resolve against `root`. */
export function absoluteIn(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

/**
 * The VerifierPort: fast tier (LSP diagnostics) + full tier (diagnostics, typecheck, targeted
 * tests, repo guards), the full tier cached by (absPath, sha-256 of the bytes). A re-check of
 * unchanged bytes costs nothing. Results are keyed by the path AS REQUESTED, so the caller's
 * own lookup finds them.
 */
export function createVerifierPort(deps: VerifyHostDeps): VerifierPort {
  const read = deps.readText ?? readText;
  const cache = createVerifyCache<readonly CheckRecord[]>();
  const diagnostics = (absPaths: readonly string[]) => pathDiagnostics(absPaths, deps.vscode, { root: deps.root });
  return {
    async diagnostics(paths) {
      // Fast tier, ≤ 3 s: language-server diagnostics for exactly these files.
      return diagnostics(paths.map((p) => absoluteIn(deps.root, p)));
    },

    async full(paths) {
      const byAbs = new Map(paths.map((p) => [absoluteIn(deps.root, p), p]));
      const records = await runFullTier([...byAbs.keys()], { root: deps.root, cache, readText: read, diagnostics });
      const out = new Map<string, readonly CheckRecord[]>();
      for (const [abs, asked] of byAbs) {
        const found = records.get(abs);
        if (found) out.set(asked, found);
      }
      return out;
    },
  };
}

/** The GitPort: real commits, real bytes. A repo the call did not name is the workspace root. */
export function createGit(deps: VerifyHostDeps): GitPort {
  const port = createGitPort(deps.git, deps.readText ?? readText);
  return { outgoing: (repo) => port.outgoing(absoluteIn(deps.root, repo || ".")) };
}

/** The ReviewerPort: one independent review sub-run (its deps are per run — see `shipPorts.ts`). */
export function createReviewer(deps: ReviewerDeps): ReviewerPort {
  return createReviewerPort(deps);
}
