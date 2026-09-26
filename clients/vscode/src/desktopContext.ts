/**
 * Builderforce Desktop — the local context service — as seen from the editor.
 *
 * The desktop app keeps a warm code index per workspace (tree-sitter definitions, a
 * reference-ranked repo map, identifier-aware keyword + local-embedding search) and
 * serves it on loopback. This module is the ONE client for it:
 *   • discovery — `~/.builderforce/desktop.json` names the port and a per-start token;
 *     a health probe (cached briefly) decides whether the service is really there;
 *   • `desktopSemanticCapability` — backs the shared `repo.semantic` capability, so the
 *     `semantic_search` / `repo_map` tools defined in `@builderforce/agent-tools` run here;
 *   • `desktopBackedTools` — drops those tools from a run's catalog when the service is
 *     absent, so a run never sees a tool whose only backing is not running;
 *   • `checkReferences` — which code names in a memory no longer exist (staleness).
 *
 * Everything degrades to "not available" (null / the tools withheld): the editor works
 * exactly as before without the desktop app. No `vscode` import — unit-testable.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  SEMANTIC_TOOLS,
  type RepoMapResult,
  type RepoSemanticCapability,
  type SemanticSearchHit,
  type SemanticSearchResult,
} from "@builderforce/agent-tools";

export interface DesktopDiscovery {
  port: number;
  token: string;
  pid: number;
  version: string;
}

interface DesktopIndexStatus {
  phase: { state: "scanning" | "embedding" | "ready"; done?: number; total?: number };
  files: number;
}

export interface MissingReference {
  reference: string;
  kind: "path" | "symbol";
}

/** How long a probe verdict (up or down) is trusted before re-checking. */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 800;
const REQUEST_TIMEOUT_MS = 10_000;
/** The repo map carried in every turn's grounding — enough to orient, small enough to keep. */
const GROUNDING_MAP_TOKENS = 1200;

const SEMANTIC_TOOL_NAMES: ReadonlySet<string> = new Set(SEMANTIC_TOOLS.map((t) => t.name));

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
let probe: { at: number; live: DesktopDiscovery | null } | null = null;

/** Test seam: swap the transport and forget any cached probe. */
export function setDesktopFetchForTests(f: FetchFn | null): void {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
  probe = null;
}

export function discoveryFilePath(): string {
  return process.env.BUILDERFORCE_DESKTOP_DISCOVERY ?? path.join(os.homedir(), ".builderforce", "desktop.json");
}

async function readDiscovery(): Promise<DesktopDiscovery | null> {
  try {
    const d = JSON.parse(await fs.readFile(discoveryFilePath(), "utf8")) as Partial<DesktopDiscovery>;
    return typeof d.port === "number" && typeof d.token === "string" ? (d as DesktopDiscovery) : null;
  } catch {
    return null;
  }
}

/** The running desktop service, or null. Cached for {@link PROBE_TTL_MS} either way. */
export async function liveDesktop(): Promise<DesktopDiscovery | null> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.live;
  const d = await readDiscovery();
  let live: DesktopDiscovery | null = null;
  if (d) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${d.port}/v1/health`, {
        headers: { Authorization: `Bearer ${d.token}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      live = res.ok ? d : null;
    } catch {
      live = null;
    }
  }
  probe = { at: Date.now(), live };
  return live;
}

/**
 * POST one operation. Null when the service is absent or went away (the probe is then
 * dropped so the next call re-checks); throws with the service's message when it
 * answered with an operation error.
 */
async function call<T>(op: string, body: Record<string, unknown>): Promise<T | null> {
  const d = await liveDesktop();
  if (!d) return null;
  let res: Response;
  try {
    res = await fetchImpl(`http://127.0.0.1:${d.port}/v1/${op}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${d.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    probe = null;
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Builderforce Desktop: ${op} failed (${res.status})`);
  return json as T;
}

function indexing(status: DesktopIndexStatus | undefined): boolean {
  return status?.phase.state === "scanning";
}

const NOT_RUNNING = "Builderforce Desktop is not running, so the semantic index is unavailable — use search_code / find_symbol instead.";

/** The `repo.semantic` capability, backed by the desktop service for `root`. */
export function desktopSemanticCapability(root: string): RepoSemanticCapability {
  return {
    async search(query, opts): Promise<SemanticSearchResult> {
      try {
        const r = await call<{ results: SemanticSearchHit[]; status: DesktopIndexStatus }>("search", {
          root,
          query,
          ...(opts?.limit ? { limit: opts.limit } : {}),
          ...(opts?.scope ? { pathPrefix: opts.scope } : {}),
        });
        if (!r) return { ok: false, error: NOT_RUNNING };
        return { ok: true, results: r.results, indexing: indexing(r.status) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    async repoMap(opts): Promise<RepoMapResult> {
      try {
        const r = await call<{ map: string; status: DesktopIndexStatus }>("repo-map", {
          root,
          ...(opts?.maxTokens ? { maxTokens: opts.maxTokens } : {}),
          ...(opts?.focus?.length ? { focus: opts.focus } : {}),
        });
        if (!r) return { ok: false, error: NOT_RUNNING };
        return { ok: true, map: r.map, indexing: indexing(r.status) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

/**
 * The run's local tools with the semantic ones kept only while the desktop service
 * answers — decided per run, so starting or quitting the app takes effect next turn.
 */
export async function desktopBackedTools<T extends { name: string }>(defs: readonly T[]): Promise<T[]> {
  const live = (await liveDesktop()) != null;
  return live ? [...defs] : defs.filter((d) => !SEMANTIC_TOOL_NAMES.has(d.name));
}

/** Ask the service to index (and watch) a workspace. Fire-and-forget on folder open. */
export async function registerWorkspace(root: string): Promise<boolean> {
  try {
    return (await call("ensure", { root })) != null;
  } catch {
    return false;
  }
}

/**
 * For each text, the code references it names that the workspace no longer contains.
 * Null when the desktop service is not running (nothing can be said either way).
 */
export async function checkReferences(root: string, texts: readonly string[]): Promise<MissingReference[][] | null> {
  if (texts.length === 0) return [];
  try {
    const r = await call<{ results: Array<{ index: number; missing: MissingReference[] }> }>("check-references", {
      root,
      texts,
    });
    if (!r) return null;
    const out: MissingReference[][] = texts.map(() => []);
    for (const row of r.results) if (row.index >= 0 && row.index < out.length) out[row.index] = row.missing;
    return out;
  } catch {
    return null;
  }
}

/**
 * The repo map as a grounding section, or '' when the service is absent or has nothing
 * indexed yet. Carried in every turn's workspace grounding (both chat surfaces).
 */
export async function desktopRepoMapSection(root: string): Promise<string> {
  const r = await desktopSemanticCapability(root).repoMap({ maxTokens: GROUNDING_MAP_TOKENS });
  if (!r.ok || !r.map?.trim()) return "";
  return [
    "## Repository map (Builderforce Desktop — files ranked by how much the code depends on them)",
    r.map.trimEnd(),
    r.indexing ? "(Indexing is still in progress — this map is partial.)" : "",
    "Use `semantic_search` to find code by meaning, and `repo_map` with `focus` for more detail on one area.",
  ]
    .filter(Boolean)
    .join("\n");
}
