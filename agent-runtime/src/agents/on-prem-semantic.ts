/**
 * The on-prem `repo.semantic` backing, resolved the way the VS Code editor resolves it
 * (`clients/vscode/src/localSemantic.ts`):
 *
 *   - Builderforce Desktop answering ⇒ its capability, with the compressor when its health
 *     probe reports one (`catalogDesktopSemantic`);
 *   - Desktop absent ⇒ `repo_map` served from the runtime's own definition index
 *     (`symbolIndexSemantic` over {@link onPremSymbolIndex}); `semantic_search` has no
 *     backing in that state, so the catalog withholds it ({@link withoutUnbackedSemanticTools}).
 *
 * The Desktop probe is cached for 30 s in node-desktop, so a per-run resolve costs nothing.
 */

import { symbolIndexSemantic, type RepoSemanticCapability } from "@builderforce/agent-tools";
import { catalogDesktopSemantic, setDesktopClientName } from "@builderforce/agent-tools/node-desktop.js";
import { onPremSymbolIndex } from "./on-prem-symbol-index.js";
import { logDebug } from "../logger.js";

/** The local-index backings this module made — they serve `repo_map` only. */
const localIndexBackings = new WeakSet<RepoSemanticCapability>();

/** True when `semantic` is the definition-index fallback (no Desktop behind it). */
export function isLocalIndexSemantic(semantic: RepoSemanticCapability | undefined): boolean {
  return semantic != null && localIndexBackings.has(semantic);
}

/** `repo_map` from the working tree's definition index — the backing without Desktop. */
export function localIndexSemantic(workspaceRoot: string): RepoSemanticCapability {
  const semantic = symbolIndexSemantic(() => onPremSymbolIndex(workspaceRoot).filesUnder());
  localIndexBackings.add(semantic);
  return semantic;
}

/** Desktop's backing when it answers, else the definition-index `repo_map`. */
export async function resolveOnPremSemantic(
  workspaceRoot: string,
  opts?: { adaptive?: boolean },
): Promise<RepoSemanticCapability> {
  setDesktopClientName("on-prem");
  const desktop = await catalogDesktopSemantic(workspaceRoot, opts).catch((err: unknown) => { logDebug(`desktop semantic unavailable, using the local index: ${String(err)}`); return undefined; });
  return desktop ?? localIndexSemantic(workspaceRoot);
}

/**
 * Drop `semantic_search` when the backing is the definition index: it would only ever
 * answer "Desktop is not running". `repo_map` stays — the index serves it.
 */
export function withoutUnbackedSemanticTools<T extends { name: string }>(
  tools: readonly T[],
  semantic: RepoSemanticCapability | undefined,
): T[] {
  return isLocalIndexSemantic(semantic) ? tools.filter((t) => t.name !== "semantic_search") : [...tools];
}
