/**
 * `@builderforce/agent-tools/node-desktop` — the ONE Builderforce Desktop client,
 * shared by the VS Code editor and the on-prem Node runtime.
 *
 * The desktop app keeps a warm code index per workspace (tree-sitter definitions, a
 * reference-ranked repo map, identifier-aware keyword + local-embedding search) and
 * serves it on loopback. This module is the client for it:
 *   • discovery — `~/.builderforce/desktop.json` names the port and a per-start token;
 *     a health probe (cached briefly) decides whether the service is really there;
 *   • `desktopSemanticCapability` — backs the shared `repo.semantic` capability, so the
 *     `semantic_search` / `repo_map` tools defined in this package run against it;
 *   • `desktopBackedTools` / `catalogDesktopSemantic` — catalog-time probe: keep those
 *     tools / advertise `repo.semantic` only while the service answers, never always-on;
 *   • `checkReferences` — which code names in a memory no longer exist (staleness);
 *   • `compress` — LLMLingua-2 token compression (PRD C8), attached to the capability
 *     only while the health probe reports the service was built with it.
 *
 * Everything degrades to "not available" (null / the tools withheld). Node-only, so it
 * lives behind its own export condition: the package root stays node-builtin-free for
 * the Worker.
 */

import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CompressResult,
  RepoMapResult,
  RepoSemanticCapability,
  SemanticSearchHit,
  SemanticSearchResult,
} from "./capabilities.js";
import { SEMANTIC_TOOLS } from "./semantic-tools.js";

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
/** Compression's first call loads (and on a fresh machine downloads) the model. */
const COMPRESS_TIMEOUT_MS = 120_000;
/** The repo map carried in every turn's grounding — enough to orient, small enough to keep. */
const GROUNDING_MAP_TOKENS = 1200;
/**
 * The grounding map's starting budget under adaptive context (cost lever
 * `c4_adaptive_context`). The section already points the model at `repo_map` with
 * `focus` for more, so the per-turn map only has to orient — the run widens on demand.
 */
export const GROUNDING_MAP_ADAPTIVE_TOKENS = 400;

const SEMANTIC_TOOL_NAMES: ReadonlySet<string> = new Set(SEMANTIC_TOOLS.map((t) => t.name));

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
let probe: { at: number; live: DesktopDiscovery | null; compress: boolean } | null = null;
/** Shown under "Recent activity" on the desktop app. VS Code sets `"vscode"`; on-prem `"on-prem"`. */
let desktopClientName = "vscode";

/** Test seam: swap the transport and forget any cached probe. */
export function setDesktopFetchForTests(f: FetchFn | null): void {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
  probe = null;
}

/** Name this client shows under in the desktop app's "Recent activity". */
export function setDesktopClientName(name: string): void {
  desktopClientName = name;
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

/**
 * Synapse as a local chat provider, discovered from the same desktop.json the
 * semantic-index client already reads.
 *
 * Independent of {@link readDiscovery}: a missing/invalid `models` object must
 * not take the semantic-desktop path down, and a file that only names
 * `models.endpoint` (no port/token) must still surface Synapse. Optional
 * `models.provider` is `"synapse"` or omitted — anything else is skipped so a
 * future non-Synapse writer cannot be misread as this provider. The id is
 * never `bfi`.
 */
export interface DesktopModelsEndpoint {
  baseUrl: string;
  token?: string;
}

function parseModelsEndpoint(raw: unknown): DesktopModelsEndpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const models = (raw as { models?: unknown }).models;
  if (!models || typeof models !== "object") return null;
  const m = models as { endpoint?: unknown; provider?: unknown; token?: unknown };
  if (typeof m.provider === "string" && m.provider.trim() && m.provider.trim().toLowerCase() !== "synapse") {
    return null;
  }
  const endpoint = typeof m.endpoint === "string" ? m.endpoint.trim() : "";
  if (!endpoint) return null;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  const token = typeof m.token === "string" && m.token.trim() ? m.token.trim() : undefined;
  return { baseUrl: endpoint, ...(token ? { token } : {}) };
}

/** Sync so {@link getLocalModelsConfig} can stay synchronous. Missing/invalid → null. */
export function readDesktopModelsEndpoint(): DesktopModelsEndpoint | null {
  try {
    return parseModelsEndpoint(JSON.parse(nodeFs.readFileSync(discoveryFilePath(), "utf8")));
  } catch {
    return null;
  }
}

/** Auth plus the name this client shows under in the app's "Recent activity". */
function serviceHeaders(d: DesktopDiscovery): Record<string, string> {
  return { Authorization: `Bearer ${d.token}`, "X-Builderforce-Client": desktopClientName };
}

/**
 * Whether a health body says compression can run: the service reports `compress` as
 * `idle` / `ready` when built with it, `disabled` without it, `unavailable` after the
 * model failed to load. An older service omits the field — not available.
 */
export function healthReportsCompress(health: unknown): boolean {
  const state = (health as { compress?: unknown } | null)?.compress;
  return state === "idle" || state === "ready";
}

/** The running desktop service, or null. Cached for {@link PROBE_TTL_MS} either way. */
export async function liveDesktop(): Promise<DesktopDiscovery | null> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.live;
  const d = await readDiscovery();
  let live: DesktopDiscovery | null = null;
  let compress = false;
  if (d) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${d.port}/v1/health`, {
        headers: serviceHeaders(d),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      live = res.ok ? d : null;
      if (live) compress = healthReportsCompress(await res.json().catch(() => null));
    } catch {
      live = null;
    }
  }
  probe = { at: Date.now(), live, compress };
  return live;
}

/** True while the live service reports the compress feature (same cached probe). */
export async function desktopCompressAvailable(): Promise<boolean> {
  return (await liveDesktop()) != null && probe?.compress === true;
}

/**
 * POST one operation. Null when the service is absent or went away (the probe is then
 * dropped so the next call re-checks); throws with the service's message when it
 * answered with an operation error.
 */
async function call<T>(op: string, body: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
  const d = await liveDesktop();
  if (!d) return null;
  let res: Response;
  try {
    res = await fetchImpl(`http://127.0.0.1:${d.port}/v1/${op}`, {
      method: "POST",
      headers: { ...serviceHeaders(d), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
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

/** Compress `text` through the desktop service. `ok: false` when absent or it failed. */
async function desktopCompress(text: string, rate: number): Promise<CompressResult> {
  try {
    const r = await call<{ text: string; originalTokens: number; keptTokens: number }>("compress", { text, rate }, COMPRESS_TIMEOUT_MS);
    if (!r) return { ok: false, error: "Builderforce Desktop is not running, so compression is unavailable." };
    return { ok: true, text: r.text, originalTokens: r.originalTokens, keptTokens: r.keptTokens };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * The `repo.semantic` capability, backed by the desktop service for `root`. `compress`
 * is attached only when the caller has seen the health probe report it — use
 * {@link catalogDesktopSemantic}, which decides that from the probe.
 */
export function desktopSemanticCapability(root: string, opts?: { compress?: boolean; adaptive?: boolean }): RepoSemanticCapability {
  return {
    ...(opts?.compress ? { compress: desktopCompress } : {}),
    ...(opts?.adaptive ? { adaptive: true } : {}),
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
          ...(opts?.query?.trim() ? { query: opts.query.trim() } : {}),
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
 * Catalog-time probe: the semantic backing when Desktop is live, else `undefined`.
 * Surfaces advertise `repo.semantic` only when this returns a capability — never always-on.
 */
export async function catalogDesktopSemantic(root: string, opts?: { adaptive?: boolean }): Promise<RepoSemanticCapability | undefined> {
  if (!(await liveDesktop())) return undefined;
  return desktopSemanticCapability(root, { compress: await desktopCompressAvailable(), adaptive: opts?.adaptive });
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
export async function desktopRepoMapSection(root: string, opts?: { adaptive?: boolean }): Promise<string> {
  // `adaptive` = the caller's `isCostLeverOn(env, "c4_adaptive_context", tenantId)`; this
  // module reads no lever. Off (or omitted) = today's 1200-token map.
  const maxTokens = opts?.adaptive ? GROUNDING_MAP_ADAPTIVE_TOKENS : GROUNDING_MAP_TOKENS;
  const r = await desktopSemanticCapability(root, { adaptive: opts?.adaptive }).repoMap({ maxTokens });
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
