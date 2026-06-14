/**
 * Native extension types — the pi-free replacement for the `@mariozechner/pi-coding-agent`
 * extension contracts the on-prem extensions reference (`ExtensionAPI`/`ExtensionContext`/
 * `ContextEvent`/`FileOperations`) (PI cutover). Minimal, usage-driven shapes faithful to
 * pi 0.54 — the native loop does not yet run an extension runner, so these keep the
 * extension modules (compaction-safeguard, context-pruning) compiling pi-free until a
 * native extension runner is wired (see Gap Register).
 */

import type { SessionManager } from "../../builderforce/agent-loop/index.js";
import type { AgentMessage } from "../../builderforce/model/agent-types.js";
import type { Model } from "../../builderforce/model/types.js";

/** Tracked file operations for a run (read/written/edited paths). */
export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

/** Fired before each LLM call with the resolved context messages. */
export interface ContextEvent {
  type: "context";
  messages: AgentMessage[];
}
export interface ContextEventResult {
  messages?: AgentMessage[];
}

/** Read-only-ish view of the agent runtime an extension handler receives. */
export interface ExtensionContext {
  cwd?: string;
  hasUI?: boolean;
  sessionManager: SessionManager;
  // biome-ignore lint/suspicious/noExplicitAny: the model registry is opaque to extensions here
  modelRegistry?: any;
  model?: Model;
  isIdle?: () => boolean;
  abort?: () => void;
}

// biome-ignore lint/suspicious/noExplicitAny: extension handler payloads vary per event
export type ExtensionHandler = (event: any, ctx: ExtensionContext) => any;

/** Extension registration surface — `on(event, handler)`. */
export interface ExtensionAPI {
  on(event: string, handler: ExtensionHandler): void;
}
