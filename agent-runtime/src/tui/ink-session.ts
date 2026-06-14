/**
 * A real, ink-driven interactive chat session wired through the `@builderforce/tui`
 * render seam — zero `@mariozechner/pi-tui`. Connects {@link GatewayChatClient}, maps its
 * `chat`/`agent` events onto the {@link TuiRenderer}'s chat surface (reusing the
 * renderer-agnostic {@link TuiStreamAssembler} for assistant-text assembly), and routes
 * the input editor's submits back to `chat.send`.
 *
 * This is the FIRST end-to-end consumer of the render port (PRD 11 §5.1 Stage 4): it does
 * not yet reach feature parity with the legacy pi-tui `tui.ts` (slash-command autocomplete,
 * bash mode, session switching, verbose stats), but it is a complete, runnable ink chat
 * loop — the foundation the remaining `src/tui` surfaces migrate onto. The wiring core
 * ({@link wireInkSession}) takes its renderer + client by INJECTION so it is unit-tested
 * headlessly (no TTY).
 */

import { resolveTuiRenderer } from "./renderer-registry.js";
import { type GatewayConnectionOptions, GatewayChatClient } from "./gateway-chat.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";
import type { ChatEntryHandle, TuiRenderer } from "@builderforce/tui";

/** The slice of {@link GatewayChatClient} the session needs — so tests inject a fake. */
export interface InkSessionClient {
  onEvent?: (evt: { event: string; payload?: unknown }) => void;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  sendChat(opts: { sessionKey: string; message: string }): Promise<{ runId: string }>;
}

export interface InkSessionDeps {
  readonly renderer: TuiRenderer;
  readonly client: InkSessionClient;
  readonly sessionKey: string;
  /** Surface model "thinking" deltas in the transcript (default false). */
  readonly showThinking?: boolean;
}

/** One-line, human-facing summary of a tool call's args (best-effort). */
function summarizeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const rec = args as Record<string, unknown>;
  for (const key of ["path", "file", "command", "query", "url"]) {
    if (typeof rec[key] === "string" && (rec[key] as string).trim()) return rec[key] as string;
  }
  return undefined;
}

/** Compact a tool result into transcript-friendly text. */
function stringifyResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result).slice(0, 2000);
  } catch {
    return String(result);
  }
}

/**
 * Wire a renderer to a gateway client: events → chat surface, submits → `chat.send`.
 * Pure (no I/O of its own) so it is driven headlessly in tests. Returns a disposer.
 */
export function wireInkSession(deps: InkSessionDeps): { dispose(): void } {
  const { renderer, client, sessionKey } = deps;
  const assembler = new TuiStreamAssembler();
  const assistantByRun = new Map<string, ChatEntryHandle>();
  const toolByCall = new Map<string, { name: string; handle: ChatEntryHandle }>();

  const upsertAssistant = (runId: string, text: string): void => {
    const existing = assistantByRun.get(runId);
    if (existing) {
      existing.update({ kind: "assistant", text });
    } else {
      assistantByRun.set(runId, renderer.chat.append({ kind: "assistant", text }));
    }
    renderer.requestRender();
  };

  const handleChat = (payload: unknown): void => {
    const p = payload as { runId?: string; state?: string; message?: unknown; sessionKey?: string } | null;
    if (!p?.runId || (p.sessionKey && p.sessionKey !== sessionKey)) return;
    if (p.state === "delta") {
      const text = assembler.ingestDelta(p.runId, p.message, deps.showThinking ?? false);
      if (text) upsertAssistant(p.runId, text);
      renderer.status.set("streaming…");
    } else if (p.state === "final") {
      const text = assembler.finalize(p.runId, p.message, deps.showThinking ?? false);
      if (text) upsertAssistant(p.runId, text);
      assistantByRun.delete(p.runId);
      renderer.input.setEnabled(true);
      renderer.status.clear();
    }
  };

  const handleAgent = (payload: unknown): void => {
    const p = payload as { runId?: string; stream?: string; data?: Record<string, unknown> } | null;
    if (!p) return;
    if (p.stream === "tool") {
      const data = p.data ?? {};
      const phase = typeof data.phase === "string" ? data.phase : "";
      const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
      const name = typeof data.name === "string" ? data.name : "tool";
      if (!toolCallId) return;
      if (phase === "start") {
        const handle = renderer.chat.append({ kind: "tool", name, detail: summarizeArgs(data.args), status: "running" });
        toolByCall.set(toolCallId, { name, handle });
      } else if (phase === "result") {
        const entry = toolByCall.get(toolCallId);
        const isError = Boolean(data.isError);
        entry?.handle.update({ kind: "tool", name: entry.name, status: isError ? "error" : "ok", result: stringifyResult(data.result) });
        toolByCall.delete(toolCallId);
      }
      renderer.requestRender();
    } else if (p.stream === "lifecycle") {
      const phase = typeof p.data?.phase === "string" ? (p.data.phase as string) : "";
      if (phase === "start") renderer.status.set("thinking…");
      else if (phase === "end") renderer.status.set("composing…");
      else if (phase === "error") renderer.status.set("run error");
    }
  };

  client.onEvent = (evt) => {
    if (evt.event === "chat") handleChat(evt.payload);
    else if (evt.event === "agent") handleAgent(evt.payload);
  };
  client.onConnected = () => renderer.status.set("connected");
  client.onDisconnected = (reason) => renderer.status.set(`disconnected: ${reason}`);

  renderer.input.onSubmit(async (raw) => {
    const value = raw.trim();
    if (!value) return;
    renderer.chat.append({ kind: "user", text: value });
    renderer.input.setEnabled(false);
    renderer.status.set("sending…");
    try {
      await client.sendChat({ sessionKey, message: value });
    } catch (err) {
      renderer.chat.append({ kind: "system", text: `[error] ${err instanceof Error ? err.message : String(err)}` });
      renderer.input.setEnabled(true);
      renderer.status.clear();
    }
  });

  return {
    dispose() {
      assistantByRun.clear();
      toolByCall.clear();
    },
  };
}

export interface RunInkSessionOptions {
  readonly sessionKey: string;
  readonly connection?: GatewayConnectionOptions;
  /** Renderer id (default `ink`); pass `headless` for non-TTY/scripted runs. */
  readonly rendererId?: string;
  readonly showThinking?: boolean;
}

/** Launch a live ink chat session against the gateway. Resolves once connected. */
export async function runInkSession(options: RunInkSessionOptions): Promise<void> {
  const renderer = resolveTuiRenderer(options.rendererId);
  const client = new GatewayChatClient(options.connection ?? {});
  wireInkSession({ renderer, client, sessionKey: options.sessionKey, showThinking: options.showThinking });
  client.start();
  renderer.start({ title: "BuilderForce Agents" });
  await client.waitForReady();
}
