/**
 * The on-prem (Node) {@link CapabilityProvider}: the disk + shell backing for the
 * SHARED, capability-gated tool registry (`@builderforce/agent-tools`). It is the
 * Node counterpart to the cloud Worker's provider — same tool definitions, different
 * concretion (Dependency Inversion). Wiring this is the foundation for the planned
 * V2 `local` surface (On-Prem runs the V2 loop instead of the legacy on-prem loop); today
 * it already lets any shared/"cloud" tool execute on-prem against a real workspace.
 */

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Capability,
  CapabilityProvider,
  HumanCapability,
  RepoDeleteResult,
  RepoEditResult,
  RepoListResult,
  RepoReadResult,
  RepoSearchResult,
  RepoWriteResult,
  ShellResult,
  WebFetchResult,
  WebSearchResult,
} from "@builderforce/agent-tools";

const execAsync = promisify(exec);

/** The capabilities a Node workspace ALWAYS backs from just a working tree. No
 *  `static-check` (it has a real shell, so it runs the actual build/tests). The
 *  optional `human` and `web.search` backings are NOT in this base set — they are
 *  added to the provider's advertised set only when their backing is injected (see
 *  {@link NodeProviderOptions}), so the surface advertises a capability iff it can
 *  physically back it (PRD 11 §5.2 — "no reduced sets", but also no phantom caps).
 *  `orchestrate` + `memory` are advertised because their tools reach module-level
 *  Node singletons (the workflow orchestrator, the project session/knowledge store)
 *  directly — no provider service object is needed, only the capability gate. */
export const NODE_SURFACE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "repo.read",
  "repo.search",
  "repo.write",
  "repo.edit",
  "repo.delete",
  "shell",
  "process",
  "web",
  "orchestrate",
  "memory",
  "message",
  "media",
]);

/** Optional backings a host injects so the Node provider can advertise the matching
 *  capability. Omitted → the cap is not advertised → the registry never offers the
 *  tool on-prem (it stays defensively unavailable). */
export interface NodeProviderOptions {
  /** Human-in-the-loop concretion (e.g. the relay approval-gate). Adds `human`. */
  human?: HumanCapability;
  /** Web-search backend (e.g. the config-resolved provider). Adds `web.search`. */
  webSearch?: (query: string) => Promise<WebSearchResult>;
}

const MAX_WEB_BYTES = 256 * 1024;

const MAX_LIST = 2000;
const MAX_SEARCH_MATCHES = 30;
const MAX_FILE_BYTES = 512 * 1024;

/** Resolve a repo-relative path INSIDE the workspace root (blocks `..` escapes). */
function resolveInRoot(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root);
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + path.sep)) return null;
  return abs;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_LIST) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_LIST) return;
    if (e.name === ".git" || e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, abs, out);
    else out.push(path.relative(root, abs).split(path.sep).join("/"));
  }
}

/**
 * Build a Node provider rooted at `workspaceRoot`. All file ops are confined to the
 * root; `shell` runs commands with `cwd = workspaceRoot`.
 */
export function buildNodeCapabilityProvider(
  workspaceRoot: string,
  options?: NodeProviderOptions,
): CapabilityProvider {
  const root = path.resolve(workspaceRoot);

  const repoRead = {
    async listFiles(sub?: string): Promise<RepoListResult> {
      const base = sub ? resolveInRoot(root, sub) : root;
      if (!base) return { ok: false, error: `path escapes workspace: ${sub}` };
      const out: string[] = [];
      await walk(root, base, out);
      return { ok: true, paths: out, truncated: out.length >= MAX_LIST };
    },
    async readFile(rel: string): Promise<RepoReadResult> {
      const abs = resolveInRoot(root, rel);
      if (!abs) return { ok: false, error: `path escapes workspace: ${rel}` };
      try {
        const buf = await fs.readFile(abs);
        const truncated = buf.byteLength > MAX_FILE_BYTES;
        return {
          ok: true,
          path: rel,
          content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"),
          truncated,
        };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async searchCode(query: string): Promise<RepoSearchResult> {
      const files: string[] = [];
      await walk(root, root, files);
      const matches: Array<{ path: string; fragments: string[] }> = [];
      let total = 0;
      for (const rel of files) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;
        const abs = path.join(root, rel);
        let text: string;
        try {
          const buf = await fs.readFile(abs);
          if (buf.byteLength > MAX_FILE_BYTES) continue;
          text = buf.toString("utf8");
        } catch {
          continue;
        }
        const fragments: string[] = [];
        for (const line of text.split("\n")) {
          if (line.includes(query)) {
            total += 1;
            if (fragments.length < 3) fragments.push(line.trim().slice(0, 200));
          }
        }
        if (fragments.length) matches.push({ path: rel, fragments });
      }
      return { ok: true, query, total, truncated: matches.length >= MAX_SEARCH_MATCHES, matches };
    },
  };

  const repoWrite = {
    async writeFile(rel: string, content: string): Promise<RepoWriteResult> {
      const abs = resolveInRoot(root, rel);
      if (!abs) return { ok: false, error: `path escapes workspace: ${rel}` };
      let existed = true;
      try {
        await fs.access(abs);
      } catch {
        existed = false;
      }
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
        return { ok: true, change: existed ? "modified" : "created" };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async editFile(
      rel: string,
      oldString: string,
      newString: string,
      replaceAll?: boolean,
    ): Promise<RepoEditResult> {
      const abs = resolveInRoot(root, rel);
      if (!abs) return { ok: false, error: `path escapes workspace: ${rel}` };
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch (e) {
        return { ok: false, error: `cannot edit '${rel}': ${(e as Error).message}` };
      }
      const count = content.split(oldString).length - 1;
      if (count === 0) return { ok: false, error: `old_string not found in '${rel}'` };
      if (count > 1 && !replaceAll) {
        return {
          ok: false,
          error: `old_string is not unique in '${rel}' (${count} matches) — add context or set replace_all`,
        };
      }
      const updated = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);
      try {
        await fs.writeFile(abs, updated, "utf8");
        return { ok: true, change: "modified", replaced: replaceAll ? count : 1 };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async deleteFile(rel: string): Promise<RepoDeleteResult> {
      const abs = resolveInRoot(root, rel);
      if (!abs) return { ok: false, error: `path escapes workspace: ${rel}` };
      try {
        await fs.access(abs);
      } catch {
        return {
          ok: true,
          deleted: false,
          note: `'${rel}' does not exist, so there is nothing to delete.`,
        };
      }
      try {
        await fs.rm(abs);
        return { ok: true, deleted: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };

  const shell = {
    async run(command: string): Promise<ShellResult> {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: root,
          maxBuffer: 8 * 1024 * 1024,
        });
        return { ok: true, exitCode: 0, stdout: `${stdout}${stderr}` };
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          exitCode: typeof err.code === "number" ? err.code : 1,
          stdout: `${err.stdout ?? ""}${err.stderr ?? ""}` || (err.message ?? "command failed"),
        };
      }
    },
  };

  const web = {
    async fetch(url: string): Promise<WebFetchResult> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { ok: false, error: `invalid url: ${url}` };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `unsupported protocol: ${parsed.protocol}` };
      }
      try {
        const res = await fetch(parsed.toString(), { redirect: "follow" });
        const contentType = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        // Reduce HTML to readable-ish text: drop script/style, strip tags, collapse ws.
        const isHtml = contentType.includes("html") || /^\s*<(!doctype|html)/i.test(raw);
        const text = isHtml
          ? raw
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          : raw;
        const truncated = text.length > MAX_WEB_BYTES;
        return {
          ok: res.ok,
          url: parsed.toString(),
          status: res.status,
          contentType,
          content: text.slice(0, MAX_WEB_BYTES),
          truncated,
        };
      } catch (e) {
        return { ok: false, url: parsed.toString(), error: (e as Error).message };
      }
    },
    async search(query: string): Promise<WebSearchResult> {
      // Backed only when a host injects `options.webSearch` (and then `web.search`
      // is advertised below). Without it the cap is absent, so the registry never
      // dispatches here — this branch is the defensive fallback.
      if (options?.webSearch) return options.webSearch(query);
      return { ok: false, query, error: "no web-search backend configured on this surface" };
    },
  };

  // Advertise the optional capabilities ONLY when their backing is wired, so the
  // surface never offers a tool it cannot fulfill (PRD 11 §5.2).
  const capabilities = new Set<Capability>(NODE_SURFACE_CAPS);
  if (options?.human) capabilities.add("human");
  if (options?.webSearch) capabilities.add("web.search");

  return { capabilities, repoRead, repoWrite, shell, web, human: options?.human };
}
