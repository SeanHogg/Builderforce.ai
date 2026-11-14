/**
 * How the native participant runs a tool call: the one-line labels the approval modal and
 * the progress lines show, the tool defs advertised to the model, the confirm predicate, and
 * the dispatcher that enforces the governance gates at the tool seam. Split from
 * `nativeBrainRun.ts`, which re-exports every name here. No `vscode` import.
 */
import { resolveToolAlias } from "@builderforce/agent-tools";
import { toolSpecsFor } from "@seanhogg/builderforce-brain-embedded";
import { describeTool } from "./fileTools";
import { evaluatePolicyGate, toolCallPaths } from "@builderforce/agent-tools";
/** Coerce a tool-call argument bag to a plain record. */
export function argsRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
/**
 * A human one-liner for a tool call — the text that reaches the approval modal and the
 * `✓`/`✗` progress lines.
 *
 * Local tools get {@link describeTool}'s path-aware phrasing; a REMOTE (gateway MCP)
 * tool is named by its verb plus whatever subject its arguments carry. Both used to be
 * re-derived inside the deleted SDK adapter; this is the one definition.
 */
export function toolLabel(defs, name, args) {
    const def = defs.find((candidate) => candidate.name === name);
    if (!def?.remote)
        return describeTool(name, args);
    const verb = name.replace(/^builtin_/, "").replace(/_/g, " ");
    const subject = (typeof args.title === "string" && args.title) ||
        (typeof args.name === "string" && args.name) ||
        (typeof args.id !== "undefined" && `#${String(args.id)}`) ||
        "";
    return subject ? `${verb}: ${subject}` : verb;
}
/**
 * The extension's `ToolDef` shape expressed as the brain core's {@link BrainAction} —
 * the ONE place that mapping lives, so the model is shown identical names, descriptions
 * and schemas whether the run is a real chat turn or an offline harness scenario.
 * `run` is supplied by the caller because WHO executes differs (the real dispatcher
 * here, a canned responder in the harness) while WHAT is advertised must not.
 */
export function toolDefActions(defs, run) {
    return defs.map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        mutates: def.mutating,
        run: (args) => run(def.name, args),
    }));
}
/** Advertise the host's tool defs to the model, through the ONE shared mapping. */
export function nativeToolSpecs(defs) {
    // Execution goes through `createNativeRunTool`, never the action's own `run` — the
    // action shape exists here only so the spec mapping stays shared with every host.
    return toolSpecsFor(toolDefActions(defs, async () => ({ ok: false, error: "not dispatched here" })));
}
/** The host's own declaration for a tool of its (`mutating`), handed to the gate so a declared-read tool is not judged a mutation by a class gate; the catalog still wins. */
function declaredOf(defs, name) {
    const def = defs.find((candidate) => candidate.name === name);
    return def ? { mutates: def.mutating } : undefined;
}
/**
 * Whether a pending call must pause for a human. TRUE for a governance
 * `require-approval` gate (always — an "acceptEdits" preference cannot waive a
 * compiled policy) and for a mutating tool while the permission mode is `ask`.
 *
 * Pure, so the loop can consult it synchronously; the actual modal is resolved
 * asynchronously off the run's pending-confirm channel.
 */
export function nativeNeedsConfirm(defs, permissionMode, gates) {
    return ({ name, args }) => {
        if (evaluatePolicyGate(gates, name, toolCallPaths(argsRecord(args)), undefined, declaredOf(defs, name)).action === "require-approval")
            return true;
        if (permissionMode === "acceptEdits")
            return false;
        const def = defs.find((candidate) => candidate.name === name);
        // Fail safe: a tool we don't recognise is treated as mutating.
        return def ? def.mutating : true;
    };
}
/** What to ask the human about a paused call. */
export function approvalRequestFor(defs, gates, name, args, 
/** The ship gate's evidence line the paused call carries (`pendingConfirm.evidence`). */
evidence) {
    const record = argsRecord(args);
    const decision = evaluatePolicyGate(gates, name, toolCallPaths(record), undefined, declaredOf(defs, name));
    return {
        name,
        args: record,
        label: toolLabel(defs, name, record),
        ...(decision.action === "require-approval" ? { gateReason: decision.reason } : {}),
        ...(evidence ? { evidence } : {}),
    };
}
/**
 * A tool result the loop can reason about. The host's `ToolDef.execute` returns a JSON
 * STRING; handing that straight to the loop would hide `{ ok:false }` from the failure
 * detector and defeat the deterministic chat↔work auto-link, which reads the created
 * row's `id` off an OBJECT. Parse when it parses, keep the text when it doesn't.
 */
export function parseToolOutput(raw) {
    const text = raw?.trim() ?? "";
    if (!text || (text[0] !== "{" && text[0] !== "["))
        return raw;
    try {
        return JSON.parse(text);
    }
    catch {
        return raw;
    }
}
/**
 * The loop's tool dispatcher for this host: enforce the governance gates at the tool
 * seam, run the real implementation, and narrate both ends onto the chat stream.
 *
 * A `block` gate never reaches the implementation — the model gets a refusal it can
 * recover from, exactly as the cloud loop's seam behaves. `require-approval` is not
 * handled here: it is a PAUSE, and pausing is the run store's confirm channel.
 */
export function createNativeRunTool(opts) {
    return async (name, args, signal) => {
        const resolved = resolveToolAlias(name);
        const record = argsRecord(args);
        const label = toolLabel(opts.defs, resolved, record);
        const decision = evaluatePolicyGate(opts.gates, resolved, toolCallPaths(record), undefined, declaredOf(opts.defs, resolved));
        if (decision.action === "block") {
            const message = opts.labels.blockedByPolicy(decision.reason);
            opts.events.onToolResult(label, false);
            return { ok: false, error: message };
        }
        const def = opts.defs.find((candidate) => candidate.name === resolved);
        if (!def)
            return { ok: false, error: `Unknown tool: ${name}` };
        // A workspace preTool hook is a gate the repository set for itself — refused the same
        // recoverable way a governance block is.
        const refused = await opts.hooks?.beforeTool(resolved, record);
        if (refused) {
            opts.events.onToolResult(label, false);
            return { ok: false, error: refused };
        }
        opts.events.onToolStart(label);
        try {
            // The call's Stop and the run's default checkout — only when there is one, so a
            // surface that passes neither calls the tool exactly as before.
            const defaultRepo = opts.defaultRepo?.();
            const runKey = opts.runKey;
            const run = signal || defaultRepo || runKey !== undefined
                ? { ...(signal ? { signal } : {}), ...(defaultRepo ? { defaultRepo } : {}), ...(runKey !== undefined ? { runKey } : {}) }
                : undefined;
            const out = run ? await def.execute(record, opts.root, run) : await def.execute(record, opts.root);
            opts.events.onToolResult(label, true);
            const parsed = parseToolOutput(out);
            return opts.hooks ? opts.hooks.afterTool(resolved, record, parsed) : parsed;
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            opts.events.onToolResult(`${label} — ${message}`, false);
            return { ok: false, error: message };
        }
    };
}
//# sourceMappingURL=nativeRunTool.js.map