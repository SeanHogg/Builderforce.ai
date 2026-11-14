/**
 * The unified tool contract. ONE shape, defined once, runnable on every surface.
 *
 * A {@link ToolDefinition} pairs an OpenAI-compatible function schema (what the
 * model sees) with a `requires` capability list (what surface can run it) and a
 * pure-ish `execute` that reaches the runtime ONLY through the injected
 * {@link ToolContext} — never through a Worker `Env`, `node:fs`, or a closure over
 * one runtime. That indirection is what lets the SAME definition run in the cloud
 * Worker, the cloud Container, and on-prem Node (Dependency Inversion: the tool
 * depends on the capability abstraction, the surface supplies the concretion).
 */
/** Small helper to build a {@link ToolDefinition} with the schema name kept in sync
 *  with `name` (one source of truth). */
export function defineTool(def) {
    return {
        name: def.name,
        requires: def.requires ?? [],
        schema: {
            type: "function",
            function: { name: def.name, description: def.description, parameters: def.parameters },
        },
        execute: def.execute,
    };
}
//# sourceMappingURL=tool.js.map