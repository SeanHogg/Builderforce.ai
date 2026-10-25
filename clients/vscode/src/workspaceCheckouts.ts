/**
 * The git checkouts sitting at the TOP level of the open folder — the candidates when
 * the folder CONTAINS repositories rather than being one. One listing, shared by the
 * run's default-repo resolution (`runDefaultRepo.ts`) and `review_ticket_branches`'
 * remedy, so the two can never disagree about which checkouts exist.
 */

import * as fs from "fs/promises";
import * as path from "path";

/** Is `dir` itself a checkout (a `.git` directory, or the file a worktree/submodule has)? */
export function isCheckout(dir: string): Promise<boolean> {
  return fs.stat(path.join(dir, ".git")).then(() => true, () => false);
}

/** The immediate subdirectories of `root` that are git checkouts, in directory order. */
export async function listCheckouts(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    if (await isCheckout(path.join(root, e.name))) out.push(e.name);
  }
  return out;
}
