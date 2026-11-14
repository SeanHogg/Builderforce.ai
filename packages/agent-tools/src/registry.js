/**
 * The single tool registry. Replaces the per-surface, hand-maintained tool arrays
 * AND the giant per-tool dispatch switch with one collection that:
 *   • is filtered to a surface by CAPABILITY (a tool appears iff the surface backs
 *     every capability it requires) — no curated allow-list per surface;
 *   • produces the OpenAI-schema array the loop sends to the model; and
 *   • dispatches a tool call by name to the matching definition's `execute`.
 *
 * Adding a tool = `register(def)`. No switch to edit, no array to fork (Open/Closed).
 */
import { resolveToolAlias } from "./toolAliases.js";
/**
 * The schema a tool is OFFERED under `caps`: its own, with the description its `describeFor` picks for
 * what the surface grants. The ONE place a capability-dependent description is applied - the registry
 * uses it for every catalog, and a host that adapts a tool itself (the editor's spawn tools) calls it
 * rather than reading `def.schema` and bypassing the capability.
 */
export function schemaForCapabilities(def, caps) {
    if (!def.describeFor)
        return def.schema;
    return { ...def.schema, function: { ...def.schema.function, description: def.describeFor(caps) } };
}
export class ToolRegistry {
    tools = new Map();
    constructor(defs = []) {
        for (const d of defs)
            this.register(d);
    }
    /** Register a tool. Throws on a duplicate name so two tools can't silently shadow. */
    register(def) {
        if (this.tools.has(def.name))
            throw new Error(`duplicate tool '${def.name}'`);
        this.tools.set(def.name, def);
        return this;
    }
    has(name) {
        return this.tools.has(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    /** True when `provider` advertises every capability `def` requires. */
    satisfies(def, caps) {
        return def.requires.every((c) => caps.has(c));
    }
    /** The tool definitions runnable under a raw capability set, in registration order. */
    toolsForCapabilities(caps) {
        return [...this.tools.values()].filter((d) => this.satisfies(d, caps));
    }
    /** The tool definitions a surface can actually run, in registration order. */
    toolsFor(provider) {
        return this.toolsForCapabilities(provider.capabilities);
    }
    /** The OpenAI-schema array for a raw capability set (schema-only surfaces, e.g. a
     *  container that runs its own loop and just needs the advertised schema). */
    schemasForCapabilities(caps) {
        return this.toolsForCapabilities(caps).map((d) => schemaForCapabilities(d, caps));
    }
    /** The OpenAI-schema array to send to the model for this surface. */
    schemasFor(provider) {
        return this.schemasForCapabilities(provider.capabilities);
    }
    /** Comma-separated tool names available to a surface — for the "unknown tool"
     *  error message so the model is told what it *can* call here. */
    availableNames(provider) {
        return this.toolsFor(provider).map((d) => d.name);
    }
    /**
     * Dispatch one tool call. Enforces capability gating at call time too (defense in
     * depth: a model can hallucinate a tool the surface didn't advertise), returning a
     * structured `ok:false` rather than throwing so the loop can feed it back.
     */
    async dispatch(name, args, ctx) {
        // Remap common hallucinations (list_dir → list_files, …) before the unknown-tool
        // check so a structured call to a synonym actually runs the catalog tool.
        const resolved = resolveToolAlias(name);
        const def = this.tools.get(resolved);
        if (!def) {
            return {
                data: {
                    ok: false,
                    error: `unknown tool '${name}'. Available tools: ${this.availableNames(ctx.caps).join(", ")}.`,
                },
            };
        }
        if (!this.satisfies(def, ctx.caps.capabilities)) {
            return {
                data: {
                    ok: false,
                    error: `tool '${resolved}' is not available on this surface (missing capability: ${def.requires
                        .filter((c) => !ctx.caps.capabilities.has(c))
                        .join(", ")}).`,
                },
            };
        }
        return def.execute(args, ctx);
    }
}
//# sourceMappingURL=registry.js.map