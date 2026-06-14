/**
 * The on-prem composition root for the render seam — the `RendererRegistry` populated
 * with the renderers this runtime ships (the render-layer twin of `resolveEngine` in
 * `builderforce-relay.ts`). Callers resolve a {@link TuiRenderer} by id and depend on the
 * interface, never on `ink` / `pi-tui` directly. Default is `ink` (the live terminal
 * renderer); tests/CI resolve `headless` explicitly. Swapping the framework is a registry
 * entry here — never a call-site edit. (PRD 11 §5.1 Stage 4 wiring.)
 */

import {
  createHeadlessRenderer,
  createInkRenderer,
  RENDERER_IDS,
  RendererRegistry,
  type TuiRenderer,
} from "@builderforce/tui";

/** Build a registry holding every renderer this runtime can resolve. */
export function buildRendererRegistry(): RendererRegistry {
  return new RendererRegistry()
    .register(RENDERER_IDS.headless, () => createHeadlessRenderer())
    .register(RENDERER_IDS.ink, () => createInkRenderer());
}

/** Resolve a fresh renderer by id (DI seam), defaulting to `ink`. */
export function resolveTuiRenderer(id?: string): TuiRenderer {
  return buildRendererRegistry().resolve(id);
}
