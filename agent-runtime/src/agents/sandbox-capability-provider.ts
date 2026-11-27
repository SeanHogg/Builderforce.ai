/**
 * `buildSandboxCapabilityProvider` — the sandbox-aware concretion of the shared
 * `@builderforce/agent-tools` {@link CapabilityProvider}, the fs-bridge twin of the
 * on-prem disk {@link buildNodeCapabilityProvider}. It lets the SAME shared
 * `ToolDefinition`s (`write_file`/`edit_file`/`delete_file`/`list_files`) run inside a
 * SANDBOXED session, where file ops are routed through the {@link SandboxFsBridge} into
 * the container rather than direct `node:fs`.
 *
 * Capability surface: `repo.read` (list/read), `repo.write`, `repo.edit`, `repo.delete`.
 * `repo.search`/`repo.symbols` are NOT advertised — there is no indexed searcher inside
 * the container; grepping is the native `exec` tool's job (which stays native).
 * `shell`/`process`/`web`/`human`/etc. stay on their native tools this pass, exactly as
 * the non-sandboxed converged set already does.
 *
 * The behaviour is the ONE shared provider (`createRepoCapabilities`) over
 * {@link sandboxWorkspaceFs}: per-file read/write/remove go through the bridge (the
 * container view), `list_files` walks the sandbox workspace's HOST mount.
 *
 * `read`/`exec`/`process` are NOT routed through this provider: `read` stays on the
 * native sandboxed read tool (image + budget features the text-only shared `read_file`
 * cannot express), and `exec`/`process` stay on the native shell tools.
 */

import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
// The ONE coding provider over the sandbox adapter (bridge read/write/remove, host-mount listing).
import { createRepoCapabilities } from "@builderforce/agent-tools/workspace";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import { sandboxWorkspaceFs } from "./sandbox/sandboxWorkspaceFs.js";

/** The capability set the sandbox provider advertises: read/write/edit/delete, WITHOUT
 *  `repo.search`/`repo.symbols` (no indexed searcher inside the container) and WITHOUT
 *  `human` (kept off this pass, as in the original converged set). */
export const SANDBOX_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.write",
  "repo.edit",
  "repo.delete",
]);

/** Per-file read/write/edit/delete confinement, mirroring the disk provider's
 *  `NodeWriteScope`: `"workspace"` confines every path inside the root (secure default);
 *  `"unconfined"` permits absolute/`..` paths outside it, matching the native sandboxed
 *  tools with `tools.fs.workspaceOnly` unset — so convergence swaps the implementation
 *  and never the security boundary. */
export type SandboxWriteScope = "workspace" | "unconfined";

export interface SandboxProviderOptions {
  /** Absolute host path of the sandbox workspace root (the container's host mount).
   *  `list_files` walks this host mount; per-file ops resolve inside it (confinement). */
  workspaceRoot: string;
  /** The session's fs-bridge — the container view used for every file read/write. */
  bridge: SandboxFsBridge;
  /** Per-file op confinement; defaults to `"workspace"` (secure by default). */
  scope?: SandboxWriteScope;
}

/**
 * Build the sandbox-aware {@link CapabilityProvider}. Per-file read/write/edit/delete
 * are backed by the {@link SandboxFsBridge} (container view, traversal-confined); the
 * capability set is exactly {@link SANDBOX_SURFACE_CAPS}.
 */
export function buildSandboxCapabilityProvider(
  options: SandboxProviderOptions,
): CapabilityProvider {
  const scope = options.scope ?? "workspace";
  const { repoRead, repoWrite } = createRepoCapabilities(
    sandboxWorkspaceFs(options.bridge, options.workspaceRoot, { scope }),
    { unconfined: scope === "unconfined" },
  );
  return {
    capabilities: SANDBOX_SURFACE_CAPS,
    // `repo.search` is not advertised, so the registry never routes `search_code` here; the
    // shared searchCode would scan the host mount, so it stays refused exactly as before.
    repoRead: {
      ...repoRead,
      async searchCode(): Promise<never> {
        throw new Error("sandbox provider does not back repo.search");
      },
    },
    repoWrite,
  };
}
