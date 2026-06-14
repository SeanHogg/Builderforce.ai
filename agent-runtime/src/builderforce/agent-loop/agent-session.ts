/**
 * Native agent session — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `AgentSession` + `createAgentSession` (PI cutover, loop stage). Wraps the native
 * {@link Agent} loop over a {@link SessionManager}, restoring prior messages on open and
 * persisting each completed message back to the JSONL session. Exposes the headless
 * subset the embedded runner consumes: `prompt`/`steer`/`abort`/`dispose`/`messages`/
 * `isStreaming`/`isCompacting`/`replaceMessages` + the underlying `agent` (whose
 * `streamFn` the runner overrides per provider/route).
 */

import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "../model/agent-types.js";
import type { ImageContent, Message, Model } from "../model/types.js";
import { Agent } from "./agent-loop.js";
import { type CompactionResult, estimateTokens, generateSummary } from "./compaction.js";
import { SessionManager, type SessionMessageEntry } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";
import type { StreamFn } from "./stream.js";

export interface CreateAgentSessionOptions {
  model: Model;
  tools?: AgentTool[];
  customTools?: AgentTool[];
  systemPrompt?: string;
  thinkingLevel?: ThinkingLevel;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
  cwd?: string;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => AgentMessage[] | Promise<AgentMessage[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** Default stream fn; the embedded runner overrides `session.agent.streamFn` per route. */
  streamFn?: StreamFn;
  /** Accepted for call-site compatibility with pi's `createAgentSession`, but unused —
   *  the native loop resolves models/auth through the gateway, not a pi ModelRegistry. */
  authStorage?: unknown;
  modelRegistry?: unknown;
  agentDir?: string;
}

export interface PromptOptions {
  images?: ImageContent[];
}

/** Persisted message roles (the loop also emits partials/custom entries we don't persist here). */
function isPersistable(role: string): boolean {
  return role === "user" || role === "assistant" || role === "toolResult";
}

export class AgentSession {
  readonly agent: Agent;
  private sessionManager: SessionManager;
  private settingsManager: SettingsManager;
  private unsubscribe: () => void;
  private _isCompacting = false;
  private _compactionAbort?: AbortController;

  constructor(opts: CreateAgentSessionOptions) {
    this.sessionManager = opts.sessionManager ?? SessionManager.create(opts.cwd ?? process.cwd());
    this.settingsManager = opts.settingsManager ?? SettingsManager.create(opts.cwd);
    const tools = [...(opts.tools ?? []), ...(opts.customTools ?? [])];
    this.agent = new Agent({
      model: opts.model,
      tools,
      systemPrompt: opts.systemPrompt,
      thinkingLevel: opts.thinkingLevel,
      convertToLlm: opts.convertToLlm,
      transformContext: opts.transformContext,
      getApiKey: opts.getApiKey,
    });
    this.agent.sessionId = this.sessionManager.getSessionId();
    if (opts.streamFn) this.agent.streamFn = opts.streamFn;

    // Restore prior conversation (post-compaction resolved context).
    const restored = this.sessionManager.buildSessionContext();
    if (restored.messages.length > 0) this.agent.replaceMessages(restored.messages);

    // Auto-persist each completed message back to the session (pi-equivalent behavior).
    this.unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_end" && isPersistable(event.message.role)) {
        this.sessionManager.appendMessage(
          event.message as Parameters<SessionManager["appendMessage"]>[0],
        );
      }
    });
  }

  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }
  get messages(): AgentMessage[] {
    return this.agent.state.messages;
  }
  get isStreaming(): boolean {
    return this.agent.isStreaming;
  }
  get isCompacting(): boolean {
    return this._isCompacting;
  }
  /** Internal: compaction routines flip this around a compaction pass. */
  setCompacting(v: boolean): void {
    this._isCompacting = v;
  }

  replaceMessages(ms: AgentMessage[]): void {
    this.agent.replaceMessages(ms);
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    return this.agent.subscribe(fn);
  }

  /** Run a user turn. `content` may be plain text or text + images. */
  async prompt(content: string, opts?: PromptOptions): Promise<void> {
    const userContent = opts?.images?.length
      ? [{ type: "text" as const, text: content }, ...opts.images]
      : content;
    await this.agent.prompt([{ role: "user", content: userContent, timestamp: Date.now() }]);
  }

  /** Inject a steering message mid-run. */
  async steer(text: string): Promise<void> {
    this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
  }

  abort(): void {
    this.agent.abort();
  }

  /** Abort an in-flight compaction pass (best-effort). */
  abortCompaction(): void {
    this._compactionAbort?.abort();
  }

  /**
   * Compact the session: summarize the older portion of history into a single checkpoint,
   * keep the most recent ~`keepRecentTokens`, persist a compaction entry, and reload the
   * agent's messages from the post-compaction context. Faithful to pi's
   * `AgentSession.compact()` shape (returns a {@link CompactionResult}).
   */
  async compact(customInstructions?: string): Promise<CompactionResult> {
    this.setCompacting(true);
    this._compactionAbort = new AbortController();
    try {
      const model = this.agent.state.model;
      const apiKey = (await this.agent.getApiKey?.(model.provider)) ?? "";
      const branch = this.sessionManager.getBranch();
      if (branch[branch.length - 1]?.type === "compaction") throw new Error("Already compacted");
      const messageEntries = branch.filter((e): e is SessionMessageEntry => e.type === "message");
      if (messageEntries.length < 2) throw new Error("Nothing to compact (session too small)");

      const keepRecent = this.settingsManager.getCompactionKeepRecentTokens();
      const reserve = this.settingsManager.getCompactionReserveTokens();
      const tokensBefore = messageEntries.reduce((s, e) => s + estimateTokens(e.message), 0);

      // Walk from the end, keeping recent messages until the keep-recent budget is hit.
      let acc = 0;
      let firstKeptIdx = messageEntries.length - 1;
      for (let i = messageEntries.length - 1; i >= 0; i--) {
        acc += estimateTokens(messageEntries[i].message);
        firstKeptIdx = i;
        if (acc >= keepRecent) break;
      }
      // Always drop at least one message so compaction makes progress.
      if (firstKeptIdx <= 0) firstKeptIdx = Math.max(1, Math.floor(messageEntries.length / 2));

      const firstKeptEntryId = messageEntries[firstKeptIdx].id;
      const dropped = messageEntries.slice(0, firstKeptIdx).map((e) => e.message);
      const summary = await generateSummary(
        dropped,
        model,
        reserve,
        apiKey,
        this._compactionAbort.signal,
        customInstructions,
      );

      this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore);
      this.agent.replaceMessages(this.sessionManager.buildSessionContext().messages);
      return { summary, firstKeptEntryId, tokensBefore };
    } finally {
      this.setCompacting(false);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/** Faithful to pi's `createAgentSession` shape: returns `{ session }`. */
export async function createAgentSession(
  options: CreateAgentSessionOptions,
): Promise<{ session: AgentSession }> {
  return { session: new AgentSession(options) };
}
