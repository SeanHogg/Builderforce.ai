/**
 * The compile primitive's intermediate representation: {@link AgentSpec} + the
 * single canonical lowering {@link lowerAgentSpec}.
 *
 * The platform has several "define a need → run an agent" front doors (a trained
 * Workforce model, a hand-drawn workflow, a persona, a plain-language ask). They
 * historically each assembled their own system prompt and exec params by ad-hoc
 * string concatenation, so persona/memory rendered differently depending on where
 * an agent ran. `AgentSpec` is the one shape every front door compiles *into*, and
 * `lowerAgentSpec` is the one function every surface lowers it *through* — so an
 * agent's identity, personality, and recalled memory render identically whether it
 * runs in the IDE, on-prem, on a durable cloud tick, or as a workflow node.
 *
 * Pure and dependency-free (no GPU, no I/O, no `Env`) so it runs in a Cloudflare
 * Worker, Node, and a VS Code extension alike — the same constraint as
 * {@link AgentEngine} and the psychometric compiler beside it. The modality compilers
 * (`compile()`) and surface deployers (`deploy()`) that produce and consume an
 * `AgentSpec` are layered on top in the `api`/`agent-runtime` packages; this file
 * owns only the IR and its lowering. The shipped compile
 * primitive is recorded in DONE.md (2026-10-25 docs-cleanup entry).
 */
import { gatePathCandidates } from "./gatePaths.js";
import { normalizeToolName } from "./toolAliases.js";
import { matchGlob } from "./glob.js";
import { inScope } from "./workstreamScope.js";
import { classifyTool, classScopedDirective, sideEffectLabel, TOOL_SIDE_EFFECTS } from "./tool-side-effect.js";
const THINK_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"];
/** The deeper of two think levels — the floor every compiler raises thinking to. */
export function maxThink(a, b) {
    if (!a)
        return b;
    return THINK_ORDER.indexOf(a) >= THINK_ORDER.indexOf(b) ? a : b;
}
/**
 * Defensively coerce an untrusted value (a parsed run payload, a dispatch frame)
 * into well-formed {@link PolicyGate}s — dropping anything without a string `id` and
 * a known `effect`. Shared so every surface that reads gates off the wire (the cloud
 * payload parser, the on-prem relay) validates them identically.
 */
function coerceGatePaths(v) {
    if (!Array.isArray(v))
        return undefined;
    const paths = v.filter((x) => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
    return paths.length ? paths : undefined;
}
export function coercePolicyGates(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const g of raw) {
        if (!g || typeof g !== "object")
            continue;
        const { id, tool, effect, directive, reason, paths, sideEffect, baseGateId } = g;
        if (typeof id !== "string")
            continue;
        if (effect !== "inject-directive" && effect !== "require-approval" && effect !== "block")
            continue;
        const coercedPaths = coerceGatePaths(paths);
        out.push({
            id,
            effect,
            ...(typeof tool === "string" ? { tool } : {}),
            ...(typeof baseGateId === "string" && baseGateId ? { baseGateId } : {}),
            ...(coercedPaths ? { paths: coercedPaths } : {}),
            ...(TOOL_SIDE_EFFECTS.includes(sideEffect) ? { sideEffect: sideEffect } : {}),
            ...(typeof directive === "string" ? { directive } : {}),
            ...(typeof reason === "string" ? { reason } : {}),
        });
    }
    return out;
}
export { toolCallPaths } from "./gatePaths.js";
function pathHitsPattern(path, pattern) {
    return matchGlob(path, pattern) || inScope(path, [pattern]);
}
function gateMatchesPath(g, callPath, workspaceRoot) {
    const patterns = g.paths;
    if (!patterns || patterns.length === 0)
        return true;
    // Every spelling of each path (`./x`, `a/../x`, backslashes, an absolute path by its tails): a scope is not stepped around by writing the path differently.
    const callPaths = (Array.isArray(callPath) ? callPath : callPath ? [callPath] : []).flatMap((p) => gatePathCandidates(p, workspaceRoot)).filter(Boolean);
    // Path-scoped but the seam did not pass a path: do not match. Existing call
    // sites that only pass toolName keep today's tool-only behaviour.
    if (callPaths.length === 0)
        return false;
    return callPaths.some((p) => patterns.some((pat) => pathHitsPattern(p, pat)));
}
/**
 * Derive the compact memory signal from a raw persistent-state snapshot. Returns
 * `undefined` for a snapshot that carries neither a step nor a data vector, so a
 * stateless agent renders no memory line. Shared so every surface summarises a
 * persistent state the same way (replaces per-call inline slicing).
 */
export function agentMemorySignal(state) {
    if (!state || typeof state !== "object")
        return undefined;
    const snap = state;
    const hasStep = typeof snap.step === "number";
    const hasData = Array.isArray(snap.data);
    if (!hasStep && !hasData)
        return undefined;
    const signal = hasData
        ? snap.data.slice(0, 4).map((v) => v.toFixed(3)).join(",")
        : "";
    return { step: snap.step ?? 0, signal };
}
function joinSkills(skills) {
    if (Array.isArray(skills))
        return skills.filter(Boolean).join(", ");
    return skills ?? "";
}
/** The single header for the persona/personality bullet block — shared by both persona renderers. */
export const PERSONA_BLOCK_HEADER = "Personality (execute under these traits):";
/**
 * Render `header` followed by `- `-prefixed bullet lines — the one system-prompt
 * sub-block shape shared by the persona, affect, and governance renderers, so they
 * cannot drift. Caller pre-filters `items`.
 */
export function bulletBlock(header, items) {
    return [header, ...items.map((x) => `- ${x}`)].join("\n");
}
/** Render one {@link PolicyGate} as a binding system-prompt line. */
function policyGateDirective(g) {
    const effectLabel = g.sideEffect ? sideEffectLabel(g.sideEffect) : "";
    const anyTool = g.sideEffect ? `any ${effectLabel} tool` : "any tool";
    const scope = !g.tool || g.tool === "*" ? anyTool : `the \`${g.tool}\` tool${g.sideEffect ? ` when it is a ${effectLabel} tool` : ""}`;
    const pathScope = g.paths?.length ? ` on ${g.paths.map((p) => `\`${p}\``).join(", ")}` : "";
    switch (g.effect) {
        case "inject-directive":
            return classScopedDirective((g.directive ?? "").trim(), g.sideEffect);
        case "require-approval":
            return `Before using ${scope}${pathScope}, pause and request explicit human approval${g.reason ? ` (${g.reason})` : ""}.`;
        case "block":
            return `Never use ${scope}${pathScope}${g.reason ? ` — ${g.reason}` : ""}. Refuse and explain instead.`;
    }
}
/**
 * Render governance gates as binding system-prompt lines (the "Governance" block).
 * Shared so every surface that injects gates into a prompt — the canonical
 * {@link lowerAgentSpec} AND the one agent (`agent-run`'s opening rows, which render a run's gates) —
 * renders them identically. Returns '' when there are no gates.
 */
export function renderPolicyDirectives(gates) {
    const lines = (gates ?? []).map(policyGateDirective).filter(Boolean);
    if (lines.length === 0)
        return "";
    return bulletBlock("Governance (these gates are binding):", lines);
}
/**
 * Hard-enforce the policy gates for a pending tool call. Pure and surface-agnostic
 * so every engine (cloud tick, on-prem loop, workflow node) enforces governance the
 * same way: call this before invoking a tool and honour the decision. `block` wins
 * over `require-approval` when both match. Gates with no `tool` (or `"*"`) match all
 * tools; gates with `paths` additionally require the call path to hit a configured
 * glob or directory prefix; gates with `sideEffect` additionally require the tool's
 * classification (unclassified ⇒ `mutate`, fail closed) to equal it. Pass `path` from {@link toolCallPaths} when the seam
 * has args — omitting it leaves path-scoped gates unmatched (existing call sites
 * keep tool-only behaviour). Tool names match case-insensitively. `workspaceRoot`, when
 * the seam knows it, lets an absolute path inside it be judged by its workspace-relative form.
 */
export function evaluatePolicyGate(gates, toolName, path, workspaceRoot, 
/** The host's own `mutates` flag for a tool the catalog does not know; the catalog classification wins. */
declared) {
    const called = normalizeToolName(toolName);
    const matches = (gates ?? []).filter((g) => (!g.tool || g.tool === "*" || normalizeToolName(g.tool) === called) &&
        (!g.sideEffect || classifyTool(called, declared) === g.sideEffect) &&
        gateMatchesPath(g, path, workspaceRoot));
    const blocked = matches.find((g) => g.effect === "block");
    if (blocked)
        return { action: "block", gateId: blocked.baseGateId ?? blocked.id, reason: blocked.reason ?? "blocked by policy" };
    const approval = matches.find((g) => g.effect === "require-approval");
    if (approval) {
        return { action: "require-approval", gateId: approval.baseGateId ?? approval.id, reason: approval.reason ?? "approval required by policy" };
    }
    return { action: "allow" };
}
/**
 * The recalled-memory block — how an agent's recalled knowledge is rendered, wherever it
 * rides: in the lowered system prompt here, or (the gateway's workforce models) on the
 * latest user message, so a per-request recall never changes the cached system prefix.
 * '' when there is nothing recalled.
 */
export function recalledKnowledgeBlock(recalledContext) {
    const recalled = recalledContext?.trim();
    return recalled ? `Relevant knowledge (recalled from this agent's memory):\n${recalled}` : "";
}
/**
 * THE canonical lowering: an {@link AgentSpec} → system prompt + model + exec
 * params. Every surface lowers through this so identity, personality, and recalled
 * memory render identically wherever the agent runs. Pure and deterministic, so it
 * is unit-testable and safe in a Worker, Node, and a VS Code extension.
 */
export function lowerAgentSpec(spec) {
    const id = spec.identity;
    const sections = [];
    // --- Identity ----------------------------------------------------------
    const header = `You are ${id.name}${id.title ? `, ${id.title}` : ""}.${id.bio ? ` ${id.bio}` : ""}`;
    const skills = joinSkills(id.skills);
    sections.push(skills ? `${header}\n\nSkills: ${skills}` : header);
    // --- Persona directives ------------------------------------------------
    const directives = spec.persona?.directives?.filter(Boolean) ?? [];
    if (directives.length > 0) {
        sections.push(bulletBlock(PERSONA_BLOCK_HEADER, directives));
    }
    // --- Recalled memory ---------------------------------------------------
    const recalled = recalledKnowledgeBlock(spec.memory?.recalledContext);
    if (recalled)
        sections.push(recalled);
    const sig = spec.memory?.stateSignal;
    if (sig) {
        sections.push(`[Memory: step=${sig.step} signal=${sig.signal} context="persistent agent state"]`);
    }
    // --- Governance gates --------------------------------------------------
    // Rendered into the prompt so policy reaches EVERY surface identically; hard
    // pause/refusal enforcement is `evaluatePolicyGate` at the engine's tool seam.
    const governance = renderPolicyDirectives(spec.policy?.gates);
    if (governance)
        sections.push(governance);
    return {
        systemPrompt: sections.join("\n\n"),
        model: spec.model?.ref ?? undefined,
        execParams: spec.persona?.execParams ?? {},
    };
}
//# sourceMappingURL=spec.js.map