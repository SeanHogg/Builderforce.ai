/**
 * Native `ToolDefinition` — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * coding-agent `ToolDefinition` (PI cutover). Faithful to pi 0.54: like {@link AgentTool}
 * but with the extra trailing `ctx` execute arg + optional UI render hooks. The native loop
 * never passes `ctx` or renders, so those are kept optional/loose; the on-prem tool pipeline
 * (`pi-tool-definition-adapter.ts`, `tool-split.ts`) compiles + runs unchanged.
 */

import type { Static, TSchema } from "@sinclair/typebox";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "../builderforce/model/agent-types.js";
import type { Tool } from "../builderforce/model/types.js";

// biome-ignore lint/suspicious/noExplicitAny: matches pi's default
export interface ToolDefinition<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends Tool<TParameters> {
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    // biome-ignore lint/suspicious/noExplicitAny: pi passes an ExtensionContext here; unused by the native loop
    ctx?: any,
  ) => Promise<AgentToolResult<TDetails>>;
  // biome-ignore lint/suspicious/noExplicitAny: pi's render hooks are pi-tui-typed; unused by the native loop
  renderCall?: (...args: any[]) => unknown;
  // biome-ignore lint/suspicious/noExplicitAny: pi's render hooks are pi-tui-typed; unused by the native loop
  renderResult?: (...args: any[]) => unknown;
}
