/**
 * run-knowledge — the TOOL VOCABULARY of a run's memory.
 *
 * Short-term vs long-term memory is a memory concept and lives in
 * `@seanhogg/builderforce-memory/working`: {@link WorkingMemory} is what this run has
 * read, searched and changed (restated before every turn by its `brief`), and
 * `consolidate` / `mergeConsolidated` turn it into the per-area code map the next run
 * recalls. That package knows observations, never tool names.
 *
 * This module is the one place that maps the platform's tool names onto those
 * observations — every runtime's spelling (shared `write_file`, on-prem native
 * `write`/`create`, …) — so the editor, on-prem and the cloud engine record a run the
 * same way. {@link RunKnowledgeRecorder} is that adapter: it owns the run's
 * {@link WorkingMemory} and the tool names a run note lists.
 */

import { WorkingMemory, consolidate, type ConsolidateOptions, type ConsolidatedMemory, type WorkingMemorySnapshot } from "@seanhogg/builderforce-memory/working";
import type { RunActivity } from "./knowledge-notes.js";
import { toolCallPaths } from "./spec.js";

/** What a tool call does to a file, by tool name. */
export type FileToolKind = "create" | "edit" | "delete" | "read";

const FILE_TOOL_KINDS: ReadonlyMap<string, FileToolKind> = new Map([
  ["write_file", "create"],
  ["write", "create"],
  ["create", "create"],
  ["edit_file", "edit"],
  ["edit", "edit"],
  ["apply_patch", "edit"],
  ["delete_file", "delete"],
  ["delete", "delete"],
  ["read_file", "read"],
  ["read", "read"],
  ["view", "read"],
  ["file_outline", "read"],
]);

/** The ONE classification of the file tools — no module keeps its own "tools that write" list. */
export function fileToolKind(name: string): FileToolKind | undefined {
  return FILE_TOOL_KINDS.get(name);
}

/** Discovery tools, by the argument that says what was looked for. */
const SEARCH_TOOLS: ReadonlyMap<string, readonly string[]> = new Map([
  ["search_code", ["query", "pattern"]],
  ["grep", ["query", "pattern"]],
  ["find_symbol", ["name", "symbol", "query"]],
  ["semantic_search", ["query"]],
  ["list_files", ["glob", "path"]],
  ["glob", ["glob", "pattern", "path"]],
]);

/** `search_code "canvas" in clients/vscode/src` — the one-line form a brief lists. */
function searchLabel(name: string, args: unknown): string | undefined {
  const keys = SEARCH_TOOLS.get(name);
  if (!keys || !args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  const what = keys.map((k) => rec[k]).find((v): v is string => typeof v === "string" && !!v.trim());
  if (!what) return undefined;
  const scope = typeof rec["path"] === "string" && rec["path"] !== what ? ` in ${rec["path"]}` : "";
  return `${name} "${what.trim().slice(0, 80)}"${scope}`;
}

/** The file a call acts on — the shared extraction the policy gates use too. */
function argPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  return toolCallPaths(args as Record<string, unknown>)[0];
}

const OBSERVATION: Record<FileToolKind, "created" | "edited" | "deleted" | "read"> = {
  create: "created",
  edit: "edited",
  delete: "deleted",
  read: "read",
};

/**
 * The recorder's CONTRACT — what a loop or host hands across a package boundary. A
 * structural interface, not the class: a bundled `.d.ts` (brain-embedded's) carries its
 * own copy of a class, and two copies of a class with private fields are different
 * types, so a host's recorder could not be passed to the loop by its class.
 */
export interface RunKnowledgeLog {
  setPrompt(prompt: string): void;
  record(name: string, args?: unknown): void;
  readonly isEmpty: boolean;
  readonly activity: RunActivity;
  /** The short-term brief for the next turn (`WorkingMemory.brief`), or null while not worth it. */
  brief(): string | null;
  /** The long-term code map this run consolidates into (`consolidate`), or null. */
  consolidate(opts?: ConsolidateOptions): ConsolidatedMemory | null;
}

/** What a run's memory carries across a host's step boundary (a durable tick). Plain data. */
export interface RunKnowledgeState {
  memory: WorkingMemorySnapshot;
  tools: string[];
}

/**
 * One run's memory, fed from its tool calls. Record SUCCESSFUL calls only — a note or a
 * map claiming a file was written when the write threw grounds every later run on a lie.
 */
export class RunKnowledgeRecorder implements RunKnowledgeLog {
  private readonly memory = new WorkingMemory();
  private readonly tools: string[] = [];

  /**
   * The recorder a resumed step continues with. A host that runs one step per process
   * (the cloud's Durable Object ticks) MUST carry this, or every step starts with an
   * empty memory: the brief is never worth giving and the run-end map covers one step.
   */
  static restore(state?: RunKnowledgeState | null): RunKnowledgeRecorder {
    const r = new RunKnowledgeRecorder();
    if (!state) return r;
    if (state.memory.task) r.memory.setTask(state.memory.task);
    for (const kind of ["created", "edited", "deleted", "read"] as const) {
      for (const path of state.memory[kind] ?? []) r.memory.observe({ kind, path });
    }
    for (const query of state.memory.searched ?? []) r.memory.observe({ kind: "searched", query });
    r.tools.push(...(state.tools ?? []));
    return r;
  }

  /** The state {@link restore} rebuilds this recorder from. */
  snapshot(): RunKnowledgeState {
    return { memory: this.memory.snapshot, tools: [...this.tools] };
  }

  setPrompt(prompt: string): void {
    this.memory.setTask(prompt);
  }

  /** Record one successful tool call. Unknown tools still count toward `tools`. */
  record(name: string, args?: unknown): void {
    this.tools.push(name);
    const search = searchLabel(name, args);
    if (search) {
      this.memory.observe({ kind: "searched", query: search });
      return;
    }
    const kind = fileToolKind(name);
    // `read_file` with `paths[]` (and no `path` — empty counts as none, as the tool reads it)
    // read every file it names.
    const rec = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
    const many = kind === "read" && !!rec && !(typeof rec.path === "string" && rec.path !== "") && Array.isArray(rec.paths);
    if (kind && many) {
      for (const path of toolCallPaths(args as Record<string, unknown>)) this.memory.observe({ kind: OBSERVATION[kind], path });
      return;
    }
    const p = kind ? argPath(args) : undefined;
    if (kind && p) this.memory.observe({ kind: OBSERVATION[kind], path: p });
  }

  /** True when nothing has been recorded — the caller can skip the write entirely. */
  get isEmpty(): boolean {
    return this.tools.length === 0;
  }

  /** This run's activity, in the shared note format's shape. `read` keeps duplicates. */
  get activity(): RunActivity {
    const s = this.memory.snapshot;
    return {
      created: s.created,
      edited: s.edited,
      deleted: s.deleted,
      read: s.read,
      tools: this.tools,
      ...(s.task ? { prompt: s.task } : {}),
    };
  }

  brief(): string | null {
    // Every tool call counts toward "long enough to need it", not only file events.
    return this.memory.brief({ observations: this.tools.length });
  }

  consolidate(opts?: ConsolidateOptions): ConsolidatedMemory | null {
    return consolidate(this.memory.snapshot, opts);
  }
}

/**
 * `log`, recording only the calls `keep` admits — for a host whose run mixes tools that
 * act on THIS workspace with remote ones that do not (the editor's platform tools). A
 * remote `search_code` searched the platform, not the repo, so it belongs in neither the
 * brief nor the workspace's code map.
 */
export function recordingOnly(log: RunKnowledgeLog, keep: (toolName: string) => boolean): RunKnowledgeLog {
  return {
    setPrompt: (prompt) => log.setPrompt(prompt),
    record: (name, args) => {
      if (keep(name)) log.record(name, args);
    },
    get isEmpty() {
      return log.isEmpty;
    },
    get activity() {
      return log.activity;
    },
    brief: () => log.brief(),
    consolidate: (opts) => log.consolidate(opts),
  };
}
