/**
 * @builderforce/tui — the render seam for the interactive CLI. ONE {@link TuiRenderer}
 * contract, resolved by id from a {@link RendererRegistry} (Dependency Injection), so the
 * terminal framework behind the CLI is swappable (ink today, native `node:tty` or a
 * vendored renderer tomorrow) without touching a single render call site.
 *
 * This is the render-layer twin of `@builderforce/agent-tools`' engine seam, and the
 * typed target the `agent-runtime/src/tui/*` sites migrate onto as `@mariozechner/pi-tui`
 * is removed (PRD 11 §5.1 Stage 4). Import this package — never couple a call site to a
 * concrete TUI framework.
 */

export * from "./renderer.js";
export * from "./registry.js";
export { createHeadlessRenderer, type HeadlessScript } from "./adapters/headless-renderer.js";
export { InkRenderer, createInkRenderer } from "./adapters/ink-renderer.js";
