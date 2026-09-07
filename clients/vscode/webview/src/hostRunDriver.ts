/**
 * The webview's run DRIVER: runs execute in the extension host, this panel only
 * watches them.
 *
 * Closing a chat tab destroys this webview's JavaScript context. When the agent loop
 * ran in here, that destroyed the run too — so the loop moved to the host
 * (`src/brainRunHost.ts`), and this module is the panel's end of that contract:
 *
 *   - `startRun` / `stopRun` / `resolveRunConfirm` / `clearRunError` — the four verbs
 *     the shared store routes through an installed driver — become `run.*` posts.
 *   - Every `run.sync` the host relays is applied to the LOCAL store with
 *     `applyRemoteRun`, so `useBrainConversation`, the timeline and the cross-chat
 *     indicator read exactly what they always read. A reopened panel is brought up to
 *     date the moment it says `ready`.
 *
 * Only the serializable half of a `BrainRunRequest` crosses the bridge; the host owns
 * the tools, the transport, persistence and memory (the same ones the native chat
 * participant uses), which is what makes the run independent of this view.
 */

import {
  applyRemoteRun,
  getRunTrace,
  installRunDriver,
  setMcpToolStatus,
  type BrainRunRequest,
  type BrainRunSnapshot,
  type BrainTraceEvent,
  type ModelFallbackSurface,
} from '@seanhogg/builderforce-brain-embedded';
import { onHostMessage, post } from './vscodeBridge';

/** What the panel knows that the host does not: its own switches and picker state. */
export interface HostRunContext {
  /**
   * The chat this panel is SHOWING. Runs for other chats keep going out in the host —
   * that is the point of the host owning them — so anything this panel says about "the
   * run" has to name which one, and anything the host announces globally has to be
   * matched against it before it lands on panel-wide state.
   */
  chatId: number | null;
  /** The Auto-mode switch — the host's confirm gate follows it live, for this chat. */
  autoApprove: boolean;
  /** The picker's model surface, for the host's stall failover. */
  modelSurface: ModelFallbackSurface | null;
}

let context: HostRunContext = { chatId: null, autoApprove: false, modelSurface: null };

/**
 * Keep the host's view of the panel's switches current. Cheap; called on change.
 *
 * Posts on a switch flip AND on a change of chat. The second is not bookkeeping: with
 * Auto scoped per-chat, a conversation parked on a confirm is unblocked by the switch
 * being on FOR THAT CHAT, and in reuse mode one panel walks between chats without ever
 * touching the switch. Announcing the binding is what lets "come back to the tab that
 * was asking, with Auto already on" answer it — the behaviour the old panel-global
 * switch got for free by shouting at every run at once.
 */
export function setHostRunContext(next: HostRunContext): void {
  const changed = next.autoApprove !== context.autoApprove || next.chatId !== context.chatId;
  context = next;
  if (changed && next.chatId != null) post('run.autoApprove', { chatId: next.chatId, on: next.autoApprove });
}

interface RunSyncFrame {
  chatId: number;
  snapshot: Omit<BrainRunSnapshot, 'trace'>;
  traceFrom: number;
  trace: BrainTraceEvent[];
}

/** Serialize the request: functions stay behind, the host supplies its own. */
function serialize(chatId: number, req: BrainRunRequest): Record<string, unknown> {
  return {
    chatId,
    systemPrompt: req.resolvedSystemPrompt,
    model: req.model,
    modelStrict: req.modelStrict,
    routingMode: req.routingMode,
    maxTokens: req.maxTokens,
    reasoning: req.reasoning,
    seed: req.seed,
    userTurn: req.userTurn,
    projectId: req.projectId ?? null,
    chatMode: req.chatMode,
    maxIterations: req.maxIterations,
    autoApprove: context.autoApprove,
    evermind: req.evermind != null,
    modelSurface: context.modelSurface,
  };
}

/**
 * Route this panel's runs through the host. Returns the teardown. Installed once at
 * module scope by the app root; the store falls back to in-process execution if it is
 * ever uninstalled, so nothing here can strand a run.
 */
export function installHostRunDriver(): () => void {
  /** Awaited starts, settled by the host's `run.settled` / `run.failed`. */
  const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

  const offSync = onHostMessage<RunSyncFrame>('run.sync', (m) => {
    const prior = getRunTrace(m.chatId);
    const trace = m.traceFrom > 0 ? [...prior.slice(0, m.traceFrom), ...m.trace] : m.trace;
    applyRemoteRun(m.chatId, { ...m.snapshot, trace, hasTrace: trace.length > 0 });
  });
  const offSettled = onHostMessage<{ chatId: number }>('run.settled', (m) => {
    pending.get(m.chatId)?.resolve();
    pending.delete(m.chatId);
  });
  const offFailed = onHostMessage<{ chatId: number; error: string }>('run.failed', (m) => {
    pending.get(m.chatId)?.reject(new Error(m.error));
    pending.delete(m.chatId);
  });
  // The host names how many tools the model can call this run, so the diagnostics
  // report keeps its "tools registered" line now that the panel registers none itself.
  // `setMcpToolStatus` is one module-level value, not a per-chat store, so a run
  // STARTING in another chat would otherwise rewrite the count this panel reports —
  // the diagnostics block would name a catalog that was never this conversation's.
  const offTools = onHostMessage<{ chatId: number; count: number }>('run.tools', (m) => {
    if (context.chatId != null && m.chatId !== context.chatId) return;
    setMcpToolStatus({ count: m.count, error: null, loading: false });
  });

  installRunDriver({
    start(chatId, req) {
      return new Promise<void>((resolve, reject) => {
        pending.get(chatId)?.resolve();
        pending.set(chatId, { resolve, reject });
        post('run.start', { run: serialize(chatId, req) });
      });
    },
    stop: (chatId) => post('run.stop', { chatId }),
    confirm: (chatId, ok) => post('run.confirm', { chatId, ok }),
    clearError: (chatId) => post('run.clearError', { chatId }),
  });

  return () => {
    offSync();
    offSettled();
    offFailed();
    offTools();
    installRunDriver(null);
  };
}
