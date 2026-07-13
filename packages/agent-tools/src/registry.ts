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

import type { Capability, CapabilityProvider } from "./capabilities.js";
import type { ToolDefinition, ToolResult, ToolSchema, ToolContext } from "./tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(defs: readonly ToolDefinition[] = []) {
    for (const d of defs) this.register(d);
  }

  /** Register a tool. Throws on a duplicate name so two tools can't silently shadow. */
  register(def: ToolDefinition): this {
    if (this.tools.has(def.name)) throw new Error(`duplicate tool '${def.name}'`);
    this.tools.set(def.name, def);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** True when `provider` advertises every capability `def` requires. */
  private satisfies(def: ToolDefinition, caps: ReadonlySet<Capability>): boolean {
    return def.requires.every((c) => caps.has(c));
  }

  /** The tool definitions runnable under a raw capability set, in registration order. */
  toolsForCapabilities(caps: ReadonlySet<Capability>): ToolDefinition[] {
    return [...this.tools.values()].filter((d) => this.satisfies(d, caps));
  }

  /** The tool definitions a surface can actually run, in registration order. */
  toolsFor(provider: CapabilityProvider): ToolDefinition[] {
    return this.toolsForCapabilities(provider.capabilities);
  }

  /** The OpenAI-schema array for a raw capability set (schema-only surfaces, e.g. a
   *  container that runs its own loop and just needs the advertised schema). */
  schemasForCapabilities(caps: ReadonlySet<Capability>): ToolSchema[] {
    return this.toolsForCapabilities(caps).map((d) => d.schema);
  }

  /** The OpenAI-schema array to send to the model for this surface. */
  schemasFor(provider: CapabilityProvider): ToolSchema[] {
    return this.schemasForCapabilities(provider.capabilities);
  }

  /** Comma-separated tool names available to a surface — for the "unknown tool"
   *  error message so the model is told what it *can* call here. */
  availableNames(provider: CapabilityProvider): string[] {
    return this.toolsFor(provider).map((d) => d.name);
  }

  /**
   * Dispatch one tool call. Enforces capability gating at call time too (defense in
   * depth: a model can hallucinate a tool the surface didn't advertise), returning a
   * structured `ok:false` rather than throwing so the loop can feed it back.
   */
  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const def = this.tools.get(name);
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
          error: `tool '${name}' is not available on this surface (missing capability: ${def.requires
            .filter((c) => !ctx.caps.capabilities.has(c))
            .join(", ")}).`,
        },
      };
    }
    return def.execute(args, ctx);
  }
}
