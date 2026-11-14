/**
 * policy/memory/learnedFacts — the model-extracted durable facts a finished run leaves.
 *
 * Ported from the editor's former `clients/vscode/src/memoryCommit.ts` (now gone; the editor keeps only the workspace reader,
 * `changedExcerpt.ts`) — after a file-changing run, the run asks
 * a cheap completion for the durable facts (decisions, root causes, conventions) and
 * writes them itself, under stable `learned:` keys so a later run on the same decision
 * REPLACES the fact instead of stacking a second one. Before this, a finished run hoped
 * the model called `remember_fact`; that call is optional, so decisions left with the
 * turn.
 *
 * The completion and the fact write are INJECTED (`LearnedFactDeps`) — the port owns
 * the extraction and the policy; an adapter supplies the model route and the store.
 * No gateway, no `node:*` here: this file is compiled into the Worker, the browser
 * and Node.
 *
 * `readChangedExcerpt`'s diff/file-head gathering is deliberately NOT ported: it reads
 * the workspace (node `fs` + `git`), which is the adapter's job — a surface that wants
 * evidence hands it in as `excerpt`.
 */
/** A fact shorter than this is noise. Matches the cloud run-memory floor. */
export const MIN_FACT_CHARS = 24;
/** How many facts one run may write. A chatty model must not flood the store. */
const MAX_FACTS = 6;
/** Prefix so these keys are not the ones `workspaceFactsSync` retires. */
const KEY_PREFIX = "learned:";
const KINDS = new Set(["decision", "root_cause", "convention"]);
/** The system prompt the utility completion sees. */
export const MEMORY_COMMIT_SYSTEM = [
    "You extract durable project facts from a finished coding run.",
    "Return a JSON array and nothing else. Each item is {key, kind, content}.",
    "kind is one of decision, root_cause, convention.",
    "key is a short kebab-case slug that stays stable if the same fact is learned again.",
    "content is one or two sentences a later run can act on, at least a full sentence.",
    "Only emit a fact the excerpt actually supports. Do not invent, and do not restate the file list.",
    "Return [] when the run learned nothing durable.",
].join(" ");
function changedPaths(input) {
    return [...new Set(input.changed.map((p) => p.trim()).filter(Boolean))];
}
/** The user message the utility model sees. Paths alone are not enough to invent from. */
export function memoryCommitPrompt(input) {
    const changed = changedPaths(input);
    const asked = (input.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    const tools = [...new Set((input.tools ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 24);
    const excerpt = (input.excerpt ?? "").trim().slice(0, 6_000);
    return [
        asked ? `Asked: ${asked}` : "",
        `Changed files:\n${changed.map((p) => `- ${p}`).join("\n")}`,
        tools.length ? `Tools: ${tools.join(", ")}` : "",
        excerpt ? `Evidence:\n${excerpt}` : "Evidence: (none recorded — return [] rather than guess)",
    ]
        .filter(Boolean)
        .join("\n\n");
}
function kebab(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}
function factKey(raw) {
    const body = kebab(raw.replace(/^learned:/i, "").replace(/^workspace:/i, ""));
    return body ? `${KEY_PREFIX}${body}` : "";
}
/**
 * Parse the model's reply into facts worth storing. Prose around a JSON array
 * is ignored; a reply that is not an array, or a fact that is too short, the
 * wrong kind, or keyed like a workspace-sync fact, is dropped.
 */
export function parseLearnedFacts(raw) {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const out = [];
    const seen = new Set();
    for (const item of parsed) {
        if (out.length >= MAX_FACTS)
            break;
        if (!item || typeof item !== "object")
            continue;
        const row = item;
        if (typeof row.kind !== "string" || !KINDS.has(row.kind))
            continue;
        if (typeof row.key !== "string" || typeof row.content !== "string")
            continue;
        if (/^workspace:/i.test(row.key.trim()))
            continue;
        const key = factKey(row.key);
        const content = row.content.replace(/\s+/g, " ").trim();
        if (!key || content.length < MIN_FACT_CHARS || seen.has(key))
            continue;
        seen.add(key);
        out.push({ key, content, kind: row.kind });
    }
    return out;
}
/**
 * Extract and write. Returns the facts that actually landed. Never throws:
 * a memory step must not turn a finished run into a failed one.
 */
export async function commitLearnedFacts(input, deps) {
    const changed = changedPaths(input);
    if (changed.length === 0)
        return [];
    let raw = "";
    try {
        raw = await deps.complete(memoryCommitPrompt({ ...input, changed }));
    }
    catch {
        return [];
    }
    const facts = parseLearnedFacts(raw);
    const landed = [];
    for (const fact of facts) {
        try {
            if (await deps.remember(fact.key, fact.content))
                landed.push(fact);
        }
        catch {
            /* one bad write must not drop the rest, and must not fail the run */
        }
    }
    return landed;
}
/** What {@link extractAndWriteLearnedFacts} needs from the run, from its own record. */
export function learnedFactsRequest(evidence) {
    const changed = [...(evidence.activity.created ?? []), ...(evidence.activity.edited ?? [])];
    return {
        changed,
        ...(evidence.activity.tools ? { tools: evidence.activity.tools } : {}),
        ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
        ...(evidence.activity.prompt ? { prompt: evidence.activity.prompt } : {}),
    };
}
/**
 * How a surface opts into the learned-facts step. `memoryHook` is a plain object the
 * composition imports directly, so the extraction's deps (the model route and the fact
 * store) cannot ride `PolicyContext.ports` — the surface registers them here instead.
 * Returns the previous provider, so a test can restore it.
 */
let learnedFactDeps = null;
export function setLearnedFactDeps(deps) {
    const prev = learnedFactDeps;
    learnedFactDeps = deps;
    return prev;
}
/** The currently-registered learned-fact deps, if a surface opted in. */
export function getLearnedFactDeps() {
    return learnedFactDeps;
}
/**
 * The learned-facts step of the run-end consolidation. Runs only when the run changed
 * files AND a surface opted in with {@link setLearnedFactDeps}; a read-only run writes
 * only its code map. Returns the facts that landed, or `null` when the step did not
 * run — so a caller can tell "nothing worth keeping" from "no provider".
 */
export async function extractAndWriteLearnedFacts(evidence) {
    const deps = learnedFactDeps;
    if (!deps)
        return null;
    return commitLearnedFacts(learnedFactsRequest(evidence), deps);
}
//# sourceMappingURL=learnedFacts.js.map