/**
 * WORKSPACE HOOKS — the shape of `.builderforce/hooks.json` and the pure decisions on it.
 *
 * A workspace's hooks are directives the agent runs at lifecycle points of every run in
 * that repository: "before you finish, update README and DONE", "lint must pass before the
 * run ends", "run the formatter after every edit", "never push unless the tests pass". They
 * live in `.builderforce/` so they are COMMITTED — everyone who opens the repository gets the
 * same actions, the way a team shares a lint config.
 *
 * No `vscode` and no I/O here: parsing, validation and matching are deterministic, and
 * tested that way (`hookConfig.test.ts`). Loading is `workspaceDirectives.ts`; running is
 * `runHooks.ts`; the trust gate for commands is `hookTrust.ts`.
 */
import { createHash } from "node:crypto";
export const HOOK_EVENTS = ["stop", "preTool", "postTool", "runEnd"];
/** The workspace folder (relative to the root) that holds the committed directives. */
export const DIRECTIVES_DIR = ".builderforce";
export const HOOKS_FILE = "hooks.json";
export const RULES_FILE = "rules.md";
/** Default wall-clock for a hook command; a hook is a check, not a build. */
export const DEFAULT_HOOK_TIMEOUT_S = 120;
/** Ceiling on a hook command — the same as an agent's own `run_command`. */
export const MAX_HOOK_TIMEOUT_S = 600;
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** Parse and validate the raw text of `hooks.json`. Never throws: problems are reported. */
export function parseHooksFile(raw) {
    let doc;
    try {
        doc = JSON.parse(raw);
    }
    catch (e) {
        return { hooks: [], problems: [`${HOOKS_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const list = isRecord(doc) ? doc.hooks : undefined;
    if (!Array.isArray(list))
        return { hooks: [], problems: [`${HOOKS_FILE} needs a top-level "hooks" array`] };
    const hooks = [];
    const problems = [];
    const seen = new Set();
    list.forEach((entry, index) => {
        const where = `hooks[${index}]`;
        if (!isRecord(entry)) {
            problems.push(`${where} is not an object`);
            return;
        }
        const on = entry.on;
        if (typeof on !== "string" || !HOOK_EVENTS.includes(on)) {
            problems.push(`${where}: "on" must be one of ${HOOK_EVENTS.join(", ")}`);
            return;
        }
        const event = on;
        const prompt = text(entry.prompt);
        const command = text(entry.command);
        if (!prompt === !command) {
            problems.push(`${where}: set exactly one of "prompt" or "command"`);
            return;
        }
        if (prompt && event !== "stop") {
            problems.push(`${where}: "prompt" is only supported on "stop" hooks — use "command" for ${event}`);
            return;
        }
        const isToolEvent = event === "preTool" || event === "postTool";
        if (entry.tool !== undefined && !isToolEvent) {
            problems.push(`${where}: "tool" only applies to preTool / postTool hooks`);
            return;
        }
        const when = entry.when ?? "codeChanged";
        if (when !== "always" && when !== "codeChanged") {
            problems.push(`${where}: "when" must be "always" or "codeChanged"`);
            return;
        }
        const id = text(entry.id) ?? `${event}#${index}`;
        if (seen.has(id)) {
            problems.push(`${where}: duplicate id "${id}"`);
            return;
        }
        seen.add(id);
        const seconds = typeof entry.timeoutSeconds === "number" && entry.timeoutSeconds > 0
            ? Math.min(entry.timeoutSeconds, MAX_HOOK_TIMEOUT_S)
            : DEFAULT_HOOK_TIMEOUT_S;
        hooks.push({
            id,
            on: event,
            ...(prompt ? { prompt } : {}),
            ...(command ? { command } : {}),
            tool: text(entry.tool) ?? "*",
            when,
            blockOnFailure: entry.blockOnFailure !== false,
            timeoutMs: seconds * 1000,
        });
    });
    return { hooks, problems };
}
/** Does a tool-event hook's matcher cover this tool call? */
export function matchesTool(hook, toolName) {
    return hook.tool.split("|").some((m) => {
        const name = m.trim();
        return name === "*" || name === toolName;
    });
}
/** Does a run-level hook apply to a run in this state? */
export function appliesToRun(hook, codeChanged) {
    return hook.when === "always" || codeChanged;
}
/**
 * Fingerprint of every COMMAND a hooks file would run. What the person approves is this
 * exact set: editing a prompt needs no re-approval, adding or changing a command does.
 */
export function commandsDigest(hooks) {
    const commands = hooks.filter((h) => h.command).map((h) => `${h.on}\u0000${h.tool}\u0000${h.command}`).sort();
    if (commands.length === 0)
        return "";
    return createHash("sha256").update(commands.join("\n")).digest("hex");
}
/** A starter file, written by the "Edit Workspace Hooks" command when none exists. */
export const STARTER_HOOKS_FILE = `${JSON.stringify({
    hooks: [
        {
            id: "docs",
            on: "stop",
            when: "codeChanged",
            prompt: "Update README.md and DONE.md with the work completed in this session.",
        },
    ],
}, null, 2)}\n`;
//# sourceMappingURL=hookConfig.js.map