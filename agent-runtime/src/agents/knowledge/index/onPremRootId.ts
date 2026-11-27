/**
 * The on-prem host's knowledge-graph root ids (`rootIdFor`, PRD 38 §4.2). A module of its own
 * so the definition index (`on-prem-symbol-index.ts`) can name its snapshot by the same id the
 * knowledge index does without importing the knowledge registry that imports it.
 */

import { basename, resolve } from "node:path";
import { folderIdOf, repoIdOfRemote, rootIdFor } from "@builderforce/agent-tools/knowledge/index.js";
import { gitOriginUrlSync } from "@builderforce/agent-tools/node-git-remote.js";

/** On-prem's host segment of a root id. */
export const ONPREM_HOST = "onprem";

/**
 * The root id of a workspace — or of `rel`, a folder inside it — by THE root-id rule
 * (`rootIdFor`, PRD 38 §4.2): `onprem:<repo>` from the checkout's git remote, else
 * `onprem:<hash of the container path>`; `…:<rel>` for a folder inside. What the PreFetch
 * port's Open-in-graph refs name.
 */
export function onPremRootId(workspaceRoot: string, rel = ""): string {
  const abs = resolve(workspaceRoot);
  return rootIdFor({ host: ONPREM_HOST, repoId: repoIdOfRemote(gitOriginUrlSync(abs)), folderId: folderIdOf(abs), path: rel });
}

/** The pre-`rootIdFor` id (`<folder name>`, `/<rel>` inside it) its local manifest was named by. */
export function onPremLegacyRootId(workspaceRoot: string, rel = ""): string {
  const base = basename(resolve(workspaceRoot)) || "workspace";
  return rel ? `${base}/${rel}` : base;
}
