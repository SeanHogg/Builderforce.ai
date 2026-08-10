/**
 * Runtime capabilities — the contract between a surface (where an agent runs) and
 * the tools it can offer.
 *
 * A {@link ToolDefinition} declares which capabilities it `requires`; a surface
 * (cloud Worker, cloud Container, on-prem Node) supplies a {@link CapabilityProvider}
 * that advertises which capabilities it can actually back. The {@link ToolRegistry}
 * offers a tool to a surface ONLY when that surface advertises every capability the
 * tool needs — so a tool set is never hand-maintained per surface, and surfaces
 * differ only by *what they can physically do*, never by a curated allow-list.
 *
 * **Capability gating vs. authorization policy are ORTHOGONAL LAYERS (not competing
 * models).** A `Capability` answers "can this SURFACE physically perform this op" (no
 * shell in a Worker → no `shell` cap). It is NOT an authorization decision. On-prem
 * additionally runs an authorization PIPELINE (owner-only / subagent-depth / group /
 * profile allow-lists) that answers "is THIS caller allowed to use this tool here."
 * The convergence (PRD 12) keeps BOTH as layers: a tool gains `requires: Capability[]`
 * for physical backing, while the surface keeps applying its policy pipeline as a
 * decorator on top. They never merge — capability is about the machine, policy is
 * about the caller — so adopting the shared contract on-prem loses no authorization.
 *
 * This module is deliberately runtime-agnostic: no `node:*`, no Cloudflare `Env`,
 * no `pi-agent-core`. It is imported verbatim by both the Cloudflare Worker `api`
 * package and the Node `agent-runtime` package, so it must type-check and bundle
 * under both `moduleResolution: bundler` and `NodeNext`.
 */

/**
 * The set of capabilities a tool can require / a surface can provide. Adding a new
 * capability here is the ONLY place a new class of tool↔surface gating is declared
 * (Open/Closed: register a tool against an existing capability without editing any
 * dispatch switch).
 */
export type Capability =
  /** List + read the working tree. */
  | "repo.read"
  /** Indexed code search across the whole tree. A DISTINCT capability from read:
   *  a surface with a real shell (the Container) greps natively and intentionally
   *  does not back the indexed searcher, so this gates `search_code` separately. */
  | "repo.search"
  /** Create / update whole files in the working tree (committed or on disk). */
  | "repo.write"
  /** Surgical in-place string edits. Separate from write so a surface can offer whole
   *  -file writes without the edit op (e.g. the container image, which only commits). */
  | "repo.edit"
  /** Delete files from the working tree. Separate from write so a surface can offer
   *  write without delete (e.g. a container image that implements commit but not rm). */
  | "repo.delete"
  /** Run a real shell command in the checked-out repo (only true Linux processes). */
  | "shell"
  /** Manage long-lived background processes spawned by `shell`. */
  | "process"
  /** Statically validate written config (JSON/YAML) WITHOUT a shell. */
  | "static-check"
  /** Escalate to a human and block until answered (approval / question / feedback). */
  | "human"
  /** Persist / recall cross-run knowledge (memory, handoff, project knowledge). */
  | "memory"
  /** Authoritatively DELETE a stored memory entry. Split from `memory` for the same
   *  reason `web.search` is split from `web`: a surface can back recall/remember
   *  without a real erase (the on-prem SSM store SUPERSEDES a belief rather than
   *  deleting it), so a surface advertises this only when `forget` truly removes. */
  | "memory.forget"
  /** Claim shared resources and read/write the run's shared workspace, so concurrent
   *  agents on one ticket can serialize conflicting work instead of clobbering it. */
  | "coordinate"
  /** Fetch a known URL's content. */
  | "web"
  /** Search the public web (needs a search backend; separate from plain fetch). */
  | "web.search"
  /** Spawn sub-agents, run orchestration workflows, dispatch to the fleet. */
  | "orchestrate"
  /** Send messages on a docked channel (Slack/Discord/Telegram/…). */
  | "message"
  /** Render / generate media (image, tts, canvas). */
  | "media";

/** A capability-scoped service. Each concrete capability interface extends this so
 *  the registry can reason about providers uniformly. Marker only — no members. */
// (Intentionally empty: capability service shapes live with their owners; the
//  provider bag below keys them by capability name.)

/** List/read/search the working tree. Backed by git-over-HTTP (cloud) or disk (Node). */
export interface RepoReadCapability {
  /** List working-tree files. `subdir` scopes to a folder; `glob` filters by name
   *  (e.g. `ROADMAP.md`, `**\/*.test.ts`) — case-insensitive, and a slash-free glob
   *  matches the basename at any depth. A `glob` also bypasses the big-repo directory
   *  summary so a matched file is always returned in full. */
  listFiles(subdir?: string, glob?: string): Promise<RepoListResult>;
  readFile(path: string): Promise<RepoReadResult>;
  /** Search the tree for `query`. Pass `scope` (a repo-relative subdirectory) to
   *  restrict the search — essential on a large monorepo where an unscoped walk can
   *  be truncated before it reaches the relevant subtree. */
  searchCode(query: string, scope?: string): Promise<RepoSearchResult>;
}

/** Mutate the working tree. The provider owns the side effects of a write —
 *  commit/disk-write AND the run bookkeeping (tracking written paths, recording a
 *  file-change event) — so a tool stays a thin schema + result shaper. */
export interface RepoWriteCapability {
  writeFile(path: string, content: string, summary?: string): Promise<RepoWriteResult>;
  deleteFile(path: string, reason?: string): Promise<RepoDeleteResult>;
  /** In-place edit: replace `oldString` with `newString` in an existing file
   *  (surgical change, no full rewrite). `replaceAll` replaces every occurrence;
   *  otherwise `oldString` must be unique. Shares the same bookkeeping as writeFile. */
  editFile(path: string, oldString: string, newString: string, replaceAll?: boolean): Promise<RepoEditResult>;
}

/** Fetch / search the public web. The two halves are still gated SEPARATELY — `fetch`
 *  by capability `web`, `search` by `web.search` — because they need different
 *  backings: fetching a known URL is just an HTTP client, while search needs a
 *  search-engine vendor. `search` stays OPTIONAL for surfaces that wire no vendor at
 *  all (the registry then never surfaces `web_search`); the cloud surface always wires
 *  one, because a keyless encyclopedic vendor is the floor beneath every BYO key. */
export interface WebCapability {
  fetch(url: string): Promise<WebFetchResult>;
  search?(query: string): Promise<WebSearchResult>;
}

/** Run a real shell command. Present only on surfaces with a true process (the
 *  cloud Container, on-prem Node) — never on the bare Worker/DO. */
export interface ShellCapability {
  run(command: string): Promise<ShellResult>;
}

/** Static, shell-free validation of written config files. */
export interface StaticCheckCapability {
  verify(): Promise<StaticCheckResult>;
}

/** Human-in-the-loop. Returns a marker the engine uses to PAUSE the run; the answer
 *  arrives on resume, so this never blocks the loop in-process on the cloud. */
export interface HumanCapability {
  ask(question: string, context?: string): Promise<HumanAskResult>;
}

/** Persist / recall cross-run knowledge (capability `memory`). On-prem it is backed by
 *  the SSM memory store (semantic recall via on-device embeddings, lexical fallback); a
 *  Worker surface can back it with KV/D1 or a hosted HTTP memory endpoint. The tool
 *  contract is identical across surfaces — only the backing differs (Dependency
 *  Inversion), so `memory_recall`/`memory_remember` are defined ONCE. */
export interface MemoryCapability {
  /** Store one durable fact under `key`. Re-using a key overwrites it. */
  remember(key: string, content: string, opts?: MemoryWriteOpts): Promise<MemoryRememberResult>;
  /** Return the entries most relevant to `query` (semantic where backed, else lexical),
   *  capped to `limit`. */
  recall(query: string, limit?: number): Promise<MemoryRecallResult>;
  /** Delete the entry stored under `key`. OPTIONAL — present iff the surface
   *  advertises `memory.forget` (see that capability's note). */
  forget?(key: string): Promise<MemoryForgetResult>;
}

/**
 * How WIDELY a remembered fact is visible. The narrower the scope, the smaller the
 * contamination blast radius: a `ticket` fact is invisible to the next ticket, a
 * `project` fact never reaches another project, and only `tenant` facts are global.
 * A surface resolves the concrete owner (which project / which ticket) from the RUN —
 * never from the model — so an agent cannot widen its own scope or aim a write at a
 * project it is not running in.
 */
export type MemoryScopeKind = "tenant" | "project" | "ticket";

/** Write-side options for {@link MemoryCapability.remember}. */
export interface MemoryWriteOpts {
  tags?: string[];
  importance?: number;
  /** Visibility of this fact. Defaults to the run's own narrowest scope. */
  scope?: MemoryScopeKind;
  /** Forget automatically after this many days. Omit for a durable fact. */
  ttlDays?: number;
}

/** One recalled memory entry. `key`/`content` are the model-facing pair; the rest is
 *  PROVENANCE — where the belief came from, how wide it is, and when it lapses. */
export interface MemoryEntry {
  key: string;
  content: string;
  scope?: MemoryScopeKind;
  /** Free-form origin marker, e.g. `cloud-run`, `ide`, `brain`, `user`. */
  origin?: string;
  /** ISO-8601 expiry, when the entry carries a TTL. */
  expiresAt?: string | null;
}

/**
 * Multi-agent coordination (capability `coordinate`). Two agents in the same stage —
 * or two stages of two tickets pointed at one repo — are concurrent writers with no
 * arbiter. This capability is that arbiter, and it has two halves:
 *
 *   • LEASES (`claim`/`release`/`listClaims`) — a mutual-exclusion lock on a named
 *     resource (a file path, a branch, a whole repo). The surface ALSO enforces
 *     leases implicitly on writes, so correctness never depends on the model
 *     choosing to call `claim` first; the tool exists so an agent can reserve work
 *     ahead of doing it and can see WHO holds what.
 *   • BLACKBOARD (`postNote`/`readNotes`) — a shared, run-scoped scratchpad so
 *     concurrent agents can publish intent ("I own the migration") and read their
 *     peers' notes, instead of each rediscovering the same context in isolation.
 */
export interface CoordinationCapability {
  /** Take a lease on `resource`. Fails (never throws) when another live holder has it. */
  claim(resource: string, opts?: { mode?: LeaseMode; reason?: string; ttlSeconds?: number }): Promise<LeaseClaimResult>;
  /** Release a lease this run holds. Releasing one it does not hold is a benign no-op. */
  release(resource: string): Promise<LeaseReleaseResult>;
  /** Every live lease in this run's coordination scope, including other agents'. */
  listClaims(): Promise<LeaseListResult>;
  /** Publish/overwrite one note on the shared workspace under `key`. */
  postNote(key: string, content: string): Promise<WorkspaceNoteResult>;
  /** Read the shared workspace, optionally filtered by a lexical `query`. */
  readNotes(query?: string, limit?: number): Promise<WorkspaceReadResult>;
}

/** `exclusive` = one holder. `shared` = many readers, but blocks an exclusive claim. */
export type LeaseMode = "exclusive" | "shared";

/** A surface's bag of capability services. A service is present iff the matching
 *  capability is in {@link capabilities}; the registry guarantees a tool's handler
 *  only runs when every required service is present, so handlers may assert them. */
export interface CapabilityProvider {
  /** Every capability this surface can physically back. */
  readonly capabilities: ReadonlySet<Capability>;
  readonly repoRead?: RepoReadCapability;
  readonly repoWrite?: RepoWriteCapability;
  readonly shell?: ShellCapability;
  readonly staticCheck?: StaticCheckCapability;
  readonly human?: HumanCapability;
  readonly web?: WebCapability;
  readonly memory?: MemoryCapability;
  readonly coordination?: CoordinationCapability;
}

// Surfaces declare their capability set EXPLICITLY (it is the source of truth for
// gating). A set is intentionally NOT auto-derived from which services are wired:
// e.g. the cloud Container wires a repo-read service but does NOT advertise
// `repo.search` (it greps via its shell), so the two must be decoupled.

// ── Result shapes (shared so both runtimes return identical tool output) ──────────

export interface RepoListResult {
  ok: boolean;
  ref?: string;
  paths?: string[];
  truncated?: boolean;
  error?: string;
}
export interface RepoReadResult {
  ok: boolean;
  path?: string;
  content?: string;
  /** True when `content` is only part of the file (a paginated line window, or the
   *  provider hit its own byte cap) — more remains beyond what was returned. */
  truncated?: boolean;
  /** Total line count of the file, so the model knows how far it has left to page. */
  totalLines?: number;
  /** 1-based line number `content` starts at (for the paginated `read_file` window). */
  offset?: number;
  /** Human/model-facing guidance, e.g. how to read the next chunk of a large file. */
  note?: string;
  error?: string;
}
export interface RepoSearchResult {
  ok: boolean;
  query?: string;
  total?: number;
  truncated?: boolean;
  matches?: Array<{ path: string } & Record<string, unknown>>;
  error?: string;
}
export interface RepoWriteResult {
  ok: boolean;
  branch?: string;
  commitUrl?: string | null;
  change?: "created" | "modified";
  /** Model-facing guidance about the write, e.g. that it was recorded rather than
   *  applied (rehearsal). Present on a SUCCESSFUL result — `error` is for failures. */
  note?: string;
  error?: string;
}
export interface RepoDeleteResult {
  ok: boolean;
  deleted?: boolean;
  branch?: string;
  commitUrl?: string | null;
  note?: string;
  code?: "not_found" | "error";
  error?: string;
}
export interface RepoEditResult {
  ok: boolean;
  branch?: string;
  commitUrl?: string | null;
  change?: "modified";
  /** How many occurrences were replaced. */
  replaced?: number;
  /** Model-facing guidance on a SUCCESSFUL edit (see {@link RepoWriteResult.note}). */
  note?: string;
  error?: string;
}
export interface ShellResult {
  ok: boolean;
  stdout?: string;
  exitCode?: number;
  error?: string;
}
export interface WebFetchResult {
  ok: boolean;
  url?: string;
  status?: number;
  contentType?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
}
export interface WebSearchResult {
  ok: boolean;
  query?: string;
  results?: Array<{ title?: string; url?: string; snippet?: string }>;
  error?: string;
  /** Licence/credit line the answering surface must carry when it uses these
   *  results (e.g. the keyless encyclopedic index is CC-BY-SA). */
  attribution?: string;
  /**
   * How WIDE the index behind these results is. `web` is a general search engine;
   * `encyclopedic` is the keyless floor — real, citable, but narrower. The model is
   * told which it got so it can say "this is what an encyclopedic index has" rather
   * than implying it swept the open web.
   */
  coverage?: 'web' | 'encyclopedic';
}
export interface StaticCheckResult {
  ok: boolean;
  ran: boolean;
  kind?: string;
  checked?: string[];
  skipped?: string[];
  errors?: Array<{ path: string; message: string }>;
  note?: string;
}
export interface HumanAskResult {
  /** True when the run must pause until a human answers (cloud surfaces). */
  paused: boolean;
  /** Opaque id the engine parks the run against. */
  approvalId?: string;
  /** Inline answer when the surface can resolve synchronously (e.g. standalone Node). */
  answer?: string | null;
  note?: string;
  error?: string;
}
export interface MemoryRememberResult {
  ok: boolean;
  key?: string;
  error?: string;
}
export interface MemoryRecallResult {
  ok: boolean;
  query?: string;
  entries?: MemoryEntry[];
  error?: string;
}
export interface MemoryForgetResult {
  ok: boolean;
  key?: string;
  /** False when no entry matched (benign — the fact is gone either way). */
  deleted?: boolean;
  error?: string;
}

/** A live lease as the coordination capability reports it. */
export interface LeaseInfo {
  resource: string;
  mode: LeaseMode;
  /** Display name of the agent holding it. */
  holder: string;
  /** True when THIS run is the holder. */
  mine: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}
export interface LeaseClaimResult {
  ok: boolean;
  resource?: string;
  mode?: LeaseMode;
  /** True when the lease was granted (or already held by this run). */
  granted?: boolean;
  /** Present when refused: who holds it and why, so the model can coordinate. */
  heldBy?: string;
  expiresAt?: string | null;
  note?: string;
  error?: string;
}
export interface LeaseReleaseResult {
  ok: boolean;
  resource?: string;
  released?: boolean;
  error?: string;
}
export interface LeaseListResult {
  ok: boolean;
  leases?: LeaseInfo[];
  error?: string;
}
export interface WorkspaceNoteResult {
  ok: boolean;
  key?: string;
  error?: string;
}
export interface WorkspaceReadResult {
  ok: boolean;
  notes?: Array<{ key: string; content: string; author: string; updatedAt: string; mine: boolean }>;
  error?: string;
}
