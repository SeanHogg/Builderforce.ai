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
import { WorkingMemory, consolidate } from "@seanhogg/builderforce-memory/working";
import { toolCallPaths } from "./spec.js";
const FILE_TOOL_KINDS = new Map([
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
export function fileToolKind(name) {
    return FILE_TOOL_KINDS.get(name);
}
/** Discovery tools, by the argument that says what was looked for. */
const SEARCH_TOOLS = new Map([
    ["search_code", ["query", "pattern"]],
    ["grep", ["query", "pattern"]],
    ["find_symbol", ["name", "symbol", "query"]],
    ["semantic_search", ["query"]],
    ["list_files", ["glob", "path"]],
    ["glob", ["glob", "pattern", "path"]],
]);
/** `search_code "canvas" in clients/vscode/src` — the one-line form a brief lists. */
function searchLabel(name, args) {
    const keys = SEARCH_TOOLS.get(name);
    if (!keys || !args || typeof args !== "object")
        return undefined;
    const rec = args;
    const what = keys.map((k) => rec[k]).find((v) => typeof v === "string" && !!v.trim());
    if (!what)
        return undefined;
    const scope = typeof rec["path"] === "string" && rec["path"] !== what ? ` in ${rec["path"]}` : "";
    return `${name} "${what.trim().slice(0, 80)}"${scope}`;
}
/** The file a call acts on — the shared extraction the policy gates use too. */
function argPath(args) {
    if (!args || typeof args !== "object" || Array.isArray(args))
        return undefined;
    return toolCallPaths(args)[0];
}
const OBSERVATION = {
    create: "created",
    edit: "edited",
    delete: "deleted",
    read: "read",
};
/**
 * One run's memory, fed from its tool calls. Record SUCCESSFUL calls only — a note or a
 * map claiming a file was written when the write threw grounds every later run on a lie.
 */
export class RunKnowledgeRecorder {
    memory = new WorkingMemory();
    tools = [];
    /**
     * The recorder a resumed step continues with. A host that runs one step per process
     * (the cloud's Durable Object ticks) MUST carry this, or every step starts with an
     * empty memory: the brief is never worth giving and the run-end map covers one step.
     */
    static restore(state) {
        const r = new RunKnowledgeRecorder();
        if (!state)
            return r;
        if (state.memory.task)
            r.memory.setTask(state.memory.task);
        for (const kind of ["created", "edited", "deleted", "read"]) {
            for (const path of state.memory[kind] ?? [])
                r.memory.observe({ kind, path });
        }
        for (const query of state.memory.searched ?? [])
            r.memory.observe({ kind: "searched", query });
        r.tools.push(...(state.tools ?? []));
        return r;
    }
    /** The state {@link restore} rebuilds this recorder from. */
    snapshot() {
        return { memory: this.memory.snapshot, tools: [...this.tools] };
    }
    setPrompt(prompt) {
        this.memory.setTask(prompt);
    }
    /** Record one successful tool call. Unknown tools still count toward `tools`. */
    record(name, args) {
        this.tools.push(name);
        const search = searchLabel(name, args);
        if (search) {
            this.memory.observe({ kind: "searched", query: search });
            return;
        }
        const kind = fileToolKind(name);
        // `read_file` with `paths[]` (and no `path` — empty counts as none, as the tool reads it)
        // read every file it names.
        const rec = args && typeof args === "object" && !Array.isArray(args) ? args : undefined;
        const many = kind === "read" && !!rec && !(typeof rec.path === "string" && rec.path !== "") && Array.isArray(rec.paths);
        if (kind && many) {
            for (const path of toolCallPaths(args))
                this.memory.observe({ kind: OBSERVATION[kind], path });
            return;
        }
        const p = kind ? argPath(args) : undefined;
        if (kind && p)
            this.memory.observe({ kind: OBSERVATION[kind], path: p });
    }
    /** True when nothing has been recorded — the caller can skip the write entirely. */
    get isEmpty() {
        return this.tools.length === 0;
    }
    /** This run's activity, in the shared note format's shape. `read` keeps duplicates. */
    get activity() {
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
    brief() {
        // Every tool call counts toward "long enough to need it", not only file events.
        return this.memory.brief({ observations: this.tools.length });
    }
    consolidate(opts) {
        return consolidate(this.memory.snapshot, opts);
    }
}
/**
 * `log`, recording only the calls `keep` admits — for a host whose run mixes tools that
 * act on THIS workspace with remote ones that do not (the editor's platform tools). A
 * remote `search_code` searched the platform, not the repo, so it belongs in neither the
 * brief nor the workspace's code map.
 */
export function recordingOnly(log, keep) {
    return {
        setPrompt: (prompt) => log.setPrompt(prompt),
        record: (name, args) => {
            if (keep(name))
                log.record(name, args);
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
//# sourceMappingURL=run-knowledge.js.map