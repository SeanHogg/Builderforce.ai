/**
 * The renderer DI seam — the render-layer twin of `resolveEngine` in
 * `agent-runtime/src/infra/builderforce-relay.ts`. A renderer is resolved by id from a
 * registry; callers depend on the {@link TuiRenderer} interface, never on a concrete
 * framework. Adding a renderer is a registry entry; retiring one is deleting its entry.
 *
 * A {@link RendererFactory} (not a prebuilt instance) is registered so each session gets
 * a fresh renderer with its own terminal/stream handles.
 */

import { type RendererId, RENDERER_IDS, type TuiRenderer } from "./renderer.js";

/** Per-session construction of a concrete renderer (handed its framework deps internally). */
export type RendererFactory = () => TuiRenderer;

/**
 * The default renderer when a caller does not name one. Stays {@link RENDERER_IDS.ink}
 * (the on-prem interactive CLI target). Tests/CI pass {@link RENDERER_IDS.headless}
 * explicitly. Flip this single constant to change the default everywhere.
 */
export const DEFAULT_RENDERER_ID: RendererId = RENDERER_IDS.ink;

/**
 * Resolves a renderer factory by id (DI). Mirrors `resolveEngine`: a record lookup with
 * a single default fallback, so the wiring is one map and the default is one constant.
 */
export class RendererRegistry {
  private readonly factories = new Map<string, RendererFactory>();

  /** Register (or replace) the factory for an id. Returns `this` for chaining. */
  register(id: string, factory: RendererFactory): this {
    this.factories.set(id, factory);
    return this;
  }

  /** True if a renderer is registered under `id`. */
  has(id: string): boolean {
    return this.factories.has(id);
  }

  /**
   * Resolve a renderer by id, falling back to {@link DEFAULT_RENDERER_ID}. Throws if
   * neither the requested id nor the default is registered (a wiring bug, surfaced loudly
   * rather than silently rendering nothing).
   */
  resolve(id?: string): TuiRenderer {
    const factory =
      this.factories.get(id ?? "") ?? this.factories.get(DEFAULT_RENDERER_ID);
    if (!factory) {
      throw new Error(
        `No renderer registered for "${id ?? DEFAULT_RENDERER_ID}" (and no default "${DEFAULT_RENDERER_ID}"). ` +
          `Register one via RendererRegistry.register().`,
      );
    }
    return factory();
  }
}
