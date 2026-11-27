/**
 * `sandboxWorkspaceFs` - the sandbox {@link WorkspaceFs}: the ONE shared coding provider
 * (`createRepoCapabilities`) over a sandboxed session. Per-file read/write/remove go through the
 * {@link SandboxFsBridge} (the container view); a listing reads the sandbox workspace's HOST mount
 * one level at a time (the bridge exposes stat/path ops, not readdir). No `search`: there is no
 * indexed searcher inside the container, and the capability set does not advertise `repo.search`.
 *
 * Containment: `workspace` scope resolves every path through the real-path resolver (links
 * followed); `unconfined` resolves against the root only, and the bridge stays the authoritative
 * boundary. A listing is always confined to the root. An escape throws
 * `WorkspaceError("outside_root", ...)`.
 */

import { readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tryResolveInsideRootReal } from "@builderforce/agent-tools/node-path.js";
import { scrubRoot } from "@builderforce/agent-tools/node-workspace";
import { WorkspaceError, type WorkspaceEntry, type WorkspaceFs, type WorkspaceRead } from "@builderforce/agent-tools/workspace";
import type { SandboxFsBridge } from "./fs-bridge.js";

export interface SandboxWorkspaceOptions {
  /** `workspace` (default): every path must resolve inside the root. `unconfined`: file ops may reach outside it (the bridge still confines). */
  scope?: "workspace" | "unconfined";
}

/** The bridge reports a missing path / a directory by message (a container `cat` or a host fs error); sniffed here, once. */
function classify(message: string): "not_found" | "is_directory" | null {
  if (message.includes("No such file") || message.includes("ENOENT")) return "not_found";
  if (message.includes("Is a directory") || message.includes("EISDIR") || message.includes("illegal operation on a directory")) return "is_directory";
  return null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The sandbox workspace rooted at the host mount `root`, read and written through `bridge`. */
export function sandboxWorkspaceFs(bridge: SandboxFsBridge, root: string, options: SandboxWorkspaceOptions = {}): WorkspaceFs {
  const rootResolved = resolve(root);
  const unconfined = options.scope === "unconfined";

  /** A raw error as a `WorkspaceError` whose message has the host mount path taken out (the model sees root-relative paths only). */
  const fail = (e: unknown): WorkspaceError => {
    if (e instanceof WorkspaceError) return e;
    return new WorkspaceError("io", scrubRoot(messageOf(e), rootResolved));
  };

  const confined = async (p: string): Promise<string> => {
    const r = await tryResolveInsideRootReal(rootResolved, p);
    if (r.ok) return r.abs;
    throw new WorkspaceError(r.reason === "escapes" ? "outside_root" : "io", r.error);
  };
  const fileAbs = async (p: string): Promise<string> =>
    unconfined ? (isAbsolute(p) ? resolve(p) : resolve(rootResolved, p)) : confined(p);

  async function* list(dir: string): AsyncIterable<WorkspaceEntry> {
    const abs = dir === "" ? rootResolved : await confined(dir);
    const entries = await readdir(abs, { withFileTypes: true }).catch((e: unknown) => {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") throw new WorkspaceError("not_found", `directory not found: ${dir}`);
      throw fail(e);
    });
    for (const entry of entries) {
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) yield { path, kind: "dir" };
      else if (entry.isFile()) yield { path, kind: "file" };
    }
  }

  async function read(p: string, { maxBytes }: { maxBytes: number }): Promise<WorkspaceRead> {
    const abs = await fileAbs(p);
    try {
      const buf = await bridge.readFile({ filePath: abs, cwd: rootResolved });
      if (buf.length <= maxBytes) return { status: "ok", content: buf.toString("utf-8"), truncated: false };
      return { status: "ok", content: buf.subarray(0, maxBytes).toString("utf-8"), truncated: true };
    } catch (e) {
      const kind = classify(messageOf(e));
      if (kind === "not_found") return { status: "not_found" };
      if (kind === "is_directory") return { status: "is_directory" };
      throw fail(e);
    }
  }

  return {
    list: (dir) => list(dir),
    read,
    async write(p, content) {
      const abs = await fileAbs(p);
      try {
        await bridge.writeFile({ filePath: abs, cwd: rootResolved, data: content });
      } catch (e) {
        throw fail(e);
      }
    },
    async remove(p) {
      const abs = await fileAbs(p);
      try {
        const stat = await bridge.stat({ filePath: abs, cwd: rootResolved });
        if (!stat) return "missing";
      } catch (e) {
        // Only a not-found classification means "already gone"; any other failure is real.
        if (classify(messageOf(e)) === "not_found") return "missing";
        throw fail(e);
      }
      try {
        await bridge.remove({ filePath: abs, cwd: rootResolved });
      } catch (e) {
        throw fail(e);
      }
      return "deleted";
    },
  };
}
