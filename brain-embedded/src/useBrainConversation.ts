'use client';

/**
 * The Brain's React binding: messages + send + the live view of the agent loop.
 *
 * The tool-call agent loop itself lives in {@link ./brainRunStore} (a
 * module-level singleton keyed by chatId), NOT in this hook — so a run survives
 * the unmount of the component that started it. When the Brain navigates the
 * user mid-run, the route-scoped panel unmounts and a different one mounts; both
 * subscribe to the same run cell, so the loop keeps streaming into whichever
 * Brain is on screen and a second instance can never spawn a duplicate loop.
 *
 * This hook: loads/persists the visible message list, mirrors the run snapshot
 * (running / streaming delta / error / pending confirmation) into render state,
 * and seeds + starts a run on send / auto-reply.
 *
 * Persistence note: the user message and EVERY assistant turn that produced
 * visible text are persisted — both a tool-call turn's narration and the final
 * answer — so each shows as its own durable bubble instead of being erased when
 * the next turn reuses the streaming buffer. Only the tool plumbing (the
 * `tool_calls` metadata and tool results) stays in-memory in the run store (the
 * chat tables have no tool columns); pure tool-call turns with no text persist
 * nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import { useRunSnapshot } from './useRunSnapshot';
import { type BrainMessage, type BrainModality, type ChatInputAttachment } from './types';
import { transcriptSeedOf } from './transcriptSeed';
import { useChatTranscript } from './useChatTranscript';
import { useAutoReplyTrailingTurn } from './useAutoReplyTrailingTurn';
import { startsRun, unansweredTurnIndex } from './userTurnRuns';
import type { BrainToolSpec, ContentPart } from './streamChatCompletion';
import type { EvermindRunHooks } from './evermindMemory';
import type { ReasoningIntent } from './effort';
import type { RunWindowSources } from './windowFit/modelWindow';
import { useComposerAttachments } from './useComposerAttachments';
import { continueOnSettle } from './runStore/continueChat';
import { getRunDriver } from './runDriver';
import { composeUserTurn, userTurnContentOf } from './attachmentTranscript';
import { scopeToConsolidation } from '@seanhogg/builderforce-memory/working';
import { contextUsageOf, type ContextUsage } from './contextUsage';
import { priorResearchDigest } from './priorResearch';
import { withDirectedMetadata, isDirectedToParticipant, directedAgentRecipients, type DirectedRecipient, type DirectedGroup } from './directedMessage';
import { buildBrainTriageReport, type BrainTraceEvent } from './brainTriage';
import type { BrainRunActivity } from './runActivity';
import { localRatingVerdict, ratedTurnContext, withRating } from './turnRating';
import { submitLocalTurnVerdict } from './localSuccess/verifiedLocalLabel';
import type { ChatErrorAction } from './chatError';
import type { ChatMode, ChatRosterAgent } from './chatMode';
import {
  startRun,
  stopRun,
  stopBeforeStart,
  isRunning,
  getRunTrace,
  resolveRunConfirm,
  clearRunError,
  type BrainRunRequest,
} from './brainRunStore';


export interface UseBrainConversationOptions {
  chatId: number | null;
  modality?: BrainModality;
  /**
   * The chat's project. Forwarded to the run so the loop's "a code change is always
   * tied to a ticket" backstop can mint a `from_delta` ticket for this project when
   * an IDE run changed code without recording one. Omit for a non-project chat / the
   * web Brain (no file tools → the backstop never fires).
   */
  projectId?: number | null;
  /** Extra system-prompt context (e.g. an IDE's open file + content). */
  extraSystem?: string;
  /** Override the system prompt entirely (e.g. a fixed Brain Storm persona). */
  systemPrompt?: string;
  /** Override the model (e.g. run the Brain as a specific assigned agent). */
  model?: string;
  /** True when `model` came from a deliberate user pick. */
  modelStrict?: boolean;
  /** Gateway-owned routing or the tenant's ordered BYO pool. */
  routingMode?: 'auto' | 'byo_pool';
  /**
   * Pick the next model when the current one burns its stall budget without emitting
   * a tool call. Hosts pass `(tried) => nextFallbackModel(surface, tried)` using the
   * `/llm/v1/models` surface they already cache. Omit to keep the run on one model
   * and stop with an explanation instead of switching.
   */
  pickFallbackModel?: (tried: readonly string[]) => string | undefined;
  /** Where the run's window fit learns a model's window — `BrainRunRequest.windowSources`. */
  windowSources?: RunWindowSources;
  /**
   * `max_tokens` for this conversation's completions — the host's Effort control
   * (see `effort.ts`, the single effort→params map). Omit for the 4096 default.
   */
  maxTokens?: number;
  /**
   * Vendor-neutral reasoning intent (the host's Thinking toggle). Build it with
   * `reasoningForRun({ effort, thinking })` so the level tracks Effort. Omit /
   * `undefined` ⇒ no `reasoning` field on the wire at all.
   */
  reasoning?: ReasoningIntent;
  /** Tool specs from the page-action registry. */
  toolSpecs?: BrainToolSpec[];
  /** Dispatch a tool call to the registry. `signal`: the call's Stop, when it is interruptible. */
  runTool?: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
  /**
   * Pure predicate: return true to pause the loop for an explicit user
   * confirmation before the tool runs (the human-in-the-loop gate). The prompt
   * UI is driven by `pendingConfirm` + `resolveConfirm` on the return value, so
   * the gate survives a navigation that swaps which Brain panel is mounted.
   * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
   * Omit to run every requested tool immediately.
   */
  needsConfirm?: (req: { name: string; args: unknown }) => boolean;
  /** Create-on-demand when sending without an active chat; returns the new chat id. */
  ensureChatId?: () => Promise<number | null>;
  /** Notify the host (chats hook) that this chat got new activity. */
  onActivity?: (chatId: number) => void;
  /**
   * Fired once when the FIRST user turn of a chat is persisted, with that turn's text —
   * the seam the host uses to auto-name a still-"New chat" conversation from what it's
   * about (wired to `useBrainChats.autoTitle`). Best-effort and idempotent on the host
   * side; omit to leave chats untitled.
   */
  onFirstUserTurn?: (chatId: number, text: string) => void;
  /**
   * Project-Evermind memory hooks, bound by the host to the active chat's project.
   * When set, a run recalls the project's learned memories before answering
   * (grounding the reply) and records recall/learn/reconcile steps in the trace.
   * Omit for a non-project chat.
   */
  evermind?: EvermindRunHooks;
  /**
   * Optional async per-turn system-prompt augment, called at run start with the
   * latest user text. Its non-empty return is appended to the system prompt for
   * that run. This is the seam a host uses for a PER-TURN async fetch the sync
   * `resolveSystemPrompt` / `extraSystem` cannot do — e.g. a fresh limbic/affect
   * block appraised against this turn's prompt (VS Code parity). Best-effort: a
   * throw / empty return just skips it. Omit when the static `extraSystem`
   * personality block is enough.
   */
  augmentSystemPrompt?: (userText: string) => Promise<string | undefined>;
  /**
   * The active chat's MODE — `chat` (answer the question) or `work` (create, staff,
   * link AND dispatch the work). Read from the chat row by the host so the choice
   * follows the conversation rather than the browser. Omit to keep the pre-mode
   * always-execute behaviour.
   */
  chatMode?: ChatMode;
  /**
   * The agents invited into the active chat. The host already holds this roster to
   * render the recipient picker and the @-mention typeahead; passing it through means
   * the RUN knows who is in the conversation too, instead of the model having to
   * discover it. A non-empty roster makes the invited agents the default owners of
   * work-mode work — see `chatMode.ts`. Omit when the host has not resolved it.
   */
  chatRoster?: readonly ChatRosterAgent[];
  /**
   * What a host can only know at RUN time, for the chat the run is in — resolved at each
   * run's start and merged OVER the request this hook builds from its render-time
   * options. The seam for a host whose tools are bound to the chat they act for (Rovr's
   * browser tools write that chat's action ledger and tasks — and a draft chat only gets
   * its id inside `send`), whose run options live on the chat's record, or whose system
   * prompt is built from live context (the working tab). A throw refuses the run with its
   * message; the user turn is already on record, so `retryLastTurn` can run it again.
   */
  prepareRun?: (chatId: number) => Promise<Partial<BrainRunRequest>>;
}

export interface UseBrainConversation {
  messages: BrainMessage[];
  loadingMessages: boolean;
  /** Force a transcript refetch without changing the chat id (e.g. after a merge). */
  reloadMessages: () => void;
  sending: boolean;
  error: string;
  /**
   * What the user can DO about {@link error}: reconnect an expired session, upgrade
   * a plan, or add a card. Decided ONCE from the gateway's structured error body
   * (see `chatErrorAction`), so an error banner renders the fix without
   * pattern-matching the message text. Null when only dismissing applies.
   */
  errorAction: ChatErrorAction | null;
  /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
  streamingText: string;
  /**
   * What the run is doing RIGHT NOW — the in-flight step (which tool, on what,
   * since when), published on ENTRY rather than on completion. Hand it straight
   * to the transcript's `activity` prop to get the animated progress row. Null
   * while idle. See `runActivity.ts`.
   */
  activity: BrainRunActivity | null;
  /** This viewer's thumb per message id (+1 up, -1 down). Hand straight to the
   *  shared transcript's `ratings` prop. */
  ratings: Record<number, 1 | -1>;
  pendingAttachments: ChatInputAttachment[];
  uploading: boolean;
  /**
   * Persist + answer a user turn. Resolves `true` once the turn is safely
   * persisted and the run has started (the message can no longer be lost), or
   * `false` if it failed before persisting (e.g. the token expired mid-send) —
   * so a composer can restore the text the user typed instead of dropping it.
   * `attachments` is the turn's OWN files (a held turn, a steer's leftovers): omitted, the turn
   * takes the composer's; given, exactly those leave the composer as the send starts and a
   * failure leaves them to the caller (`restoreAttachments`).
   */
  send(text: string, opts?: { addressedTo?: DirectedRecipient | DirectedGroup | readonly DirectedRecipient[] | null; attachments?: ChatInputAttachment[] }): Promise<boolean>;
  /**
   * Answer the active chat's REFUSED turn again — the trailing user message nothing
   * replied to (only step rows after it), e.g. a turn a `no_local_model` verdict stopped.
   * The remedy's re-send ("Switch to Hybrid" → this): the message is already persisted,
   * so it is NOT written again — the run starts on it exactly as the auto-reply does.
   * Returns false (and does nothing) when a run is in flight or there is no such turn.
   */
  retryLastTurn(): boolean;
  /**
   * Stop the in-flight run for the active chat: aborts the streaming LLM request
   * and unwinds the agent loop (no error surfaced). No-op when nothing is
   * running. Pair with `sending` to drive a Stop button.
   */
  stop(): void;
  /**
   * Rate one assistant reply (+1 / -1, or 0 to clear). Beyond flipping the thumb it
   * derives WHAT is being rated — the model that served the turn and the MCP tool it
   * ran ({@link ratedTurnContext}) — and sends that with the vote, which is what
   * makes the press teach the learned router instead of just colouring a button.
   */
  rateMessage(msg: BrainMessage, rating: 1 | -1 | 0): Promise<void>;
  attach(file: File): Promise<void>;
  removeAttachment(key: string): void;
  /**
   * Put files back in the composer after a send that was not kept - merged by key, so calling it
   * twice (or for a file already there) never duplicates. The ONE restore: the web panel and the
   * editor's chat both use it for a turn they gave its own files.
   */
  restoreAttachments(files: readonly ChatInputAttachment[]): void;
  setError(msg: string): void;
  /**
   * Dismiss the current error banner. Clears BOTH the hook's local error and the
   * run cell's error (a failed LLM stream / tool loop sets the latter, which
   * `setError('')` alone can't reach) — so the user can always close the banner.
   */
  clearError(): void;
  /** A tool call awaiting the user's Approve/Cancel decision (or null). */
  pendingConfirm: { name: string; args: unknown } | null;
  /** Resolve the pending confirmation. */
  resolveConfirm(ok: boolean): void;
  /**
   * True once the active chat has any recorded execution steps (LLM/tool/error)
   * — drives the "capture execution" affordance.
   */
  hasTrace: boolean;
  /**
   * The live execution trace (LLM turns + tool calls + errors) for the active
   * chat, in order — updated AS THE RUN HAPPENS. Render it as the timeline's
   * tool/thinking/error steps; pair it with `messages` for the durable
   * user/assistant turns. Empty when the chat has no run this session.
   */
  trace: BrainTraceEvent[];
  /** How full the model's context was on the last turn — the composer's context meter
   *  (`contextUsageOf` over the live trace, then the persisted steps). */
  contextUsage: ContextUsage | null;
  /**
   * Connected providers the gateway could NOT use this run (e.g. an expired Claude
   * subscription that fell back to the shared pool). A mounted view renders a passive
   * "reconnect your account" banner off this; empty when everything resolved.
   */
  byoUnresolved: string[];
  /**
   * BYO providers that hit a usage/capacity cap this run (e.g. Anthropic monthly
   * spend limit, Meta MUSE quota exhausted). A mounted view renders a "manage your
   * API keys" banner so the user can top up or switch providers. Empty when no cap
   * was hit this run.
   */
  providerCap: string[];
  /**
   * Assemble a paste-able triage report of the active chat's execution — the LLM
   * steps, the full tool chain (args + results), intermediate assistant messages,
   * every error, and the visible transcript. `agentLabel` names the persona the
   * Brain ran as; `surface` names where it ran (e.g. `VS Code (VSIX)`). Mirrors the
   * host/cloud "Copy triage info" report.
   */
  buildTriageReport(agentLabel?: string, surface?: string): string;
}

export { unansweredTurnIndex } from './userTurnRuns';

export function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation {
  const { persistence, resolveSystemPrompt, stream, imagePrep } = useBrainConfig();
  const {
    chatId,
    modality = 'designer',
    projectId,
    extraSystem,
    systemPrompt,
    model,
    modelStrict,
    routingMode,
    pickFallbackModel,
    windowSources,
    maxTokens,
    reasoning,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity,
    onFirstUserTurn,
    evermind,
    augmentSystemPrompt,
    chatMode,
    chatRoster,
    prepareRun,
  } = options;

  // Which chats THIS hook instance has a send in flight for: persisting the user turn,
  // then holding until the run settles (a driver-owned run's `running` only lands with
  // its first sync, so the snapshot alone would leave a gap). Keyed by chat because one
  // instance serves a panel that WALKS between chats — a single boolean made a send in
  // chat A mark every chat busy, so "New chat" showed A's Stop button, queued its
  // composer behind A, and could not run in parallel. `null` is a draft chat whose
  // server row `ensureChatId` is still creating.
  const sendingRef = useRef<ReadonlySet<number | null>>(new Set());
  const [sendingChats, setSendingChats] = useState<ReadonlySet<number | null>>(sendingRef.current);
  /** Chats whose Stop came while a send was getting ready — its launch is dropped. `null`
   *  is a draft whose row is still being created; the mark moves to the chat it becomes. */
  const cancelledLaunchRef = useRef(new Set<number | null>());
  /** Chats with a launch (send, auto-reply or Retry) not yet started — a Stop drops it. */
  const launchingRef = useRef(new Set<number>());
  const markSending = useCallback((key: number | null, on: boolean) => {
    const next = new Set(sendingRef.current);
    if (on) next.add(key);
    else next.delete(key);
    sendingRef.current = next;
    setSendingChats(next);
  }, []);
  const localSending = sendingChats.has(chatId);
  // The chat on screen NOW. A send outlives a switch, and must not write its turn (or
  // its failure) into the conversation the user moved to.
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const [localError, setLocalError] = useState('');
  const [ratings, setRatings] = useState<Record<number, 1 | -1>>({});
  const composer = useComposerAttachments(persistence, imagePrep, setLocalError);
  const { pending: pendingAttachments, uploading } = composer;
  const autoRepliedChatIdRef = useRef<number | null>(null);

  // Live view of the chat's run (owned by the module-level store) — always THIS chat's
  // cell, including on the render a switch lands in.
  const snapshot = useRunSnapshot(chatId);

  // The durable transcript for the chat on screen (`useChatTranscript`).
  const { messages, updateMessages, loadingMessages, reloadMessages } = useChatTranscript(persistence, chatId, snapshot, {
    onLoadStart: () => setLocalError(''),
    onLoadError: setLocalError,
  });
  // The latest transcript, for callbacks that must keep their identity across appends.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Re-hydrate this viewer's thumbs from the persisted message metadata, so a
  // reopened chat shows what they already pressed. (The durable RATING fact lives in
  // `llm_action_ratings`; this is only the UI state the message still carries.)
  useEffect(() => {
    const map: Record<number, 1 | -1> = {};
    for (const msg of messages) {
      if (!msg.metadata) continue;
      try {
        const meta = JSON.parse(msg.metadata) as { feedback?: 'up' | 'down' };
        if (meta.feedback === 'up') map[msg.id] = 1;
        else if (meta.feedback === 'down') map[msg.id] = -1;
      } catch { /* ignore */ }
    }
    setRatings(map);
  }, [messages]);

  const resolvedSystemPrompt = systemPrompt ?? resolveSystemPrompt(modality);
  const fullSystemPrompt = extraSystem ? `${resolvedSystemPrompt}\n${extraSystem}` : resolvedSystemPrompt;

  /** Assemble the BrainRunRequest from the current options (captured at run start). */
  const buildRequest = useCallback(
    (history: BrainMessage[], researchFrom: BrainMessage[], userTurn: string | ContentPart[], userTurnMessageId?: number) => {
      // The seed and the persisted ids behind it (a fold records what its note covers),
      // and what the earlier turns READ (`priorResearch.ts`).
      const seed = transcriptSeedOf(history);
      return {
      resolvedSystemPrompt: fullSystemPrompt,
      tools: toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined,
      model,
      modelStrict,
      routingMode,
      pickFallbackModel,
      ...(windowSources ? { windowSources } : {}),
      maxTokens,
      reasoning,
      runTool,
      needsConfirm,
      stream,
      persistence,
      onActivity,
      evermind,
      augmentSystemPrompt,
      seed: seed.messages,
      seedIds: seed.ids,
      priorResearch: priorResearchDigest(scopeToConsolidation(researchFrom)),
      userTurn,
      ...(userTurnMessageId != null ? { userTurnMessageId } : {}),
      projectId,
      chatMode,
      chatRoster,
      };
    },
    [fullSystemPrompt, toolSpecs, model, modelStrict, routingMode, pickFallbackModel, windowSources, maxTokens, reasoning, runTool, needsConfirm, stream, persistence, onActivity, evermind, augmentSystemPrompt, projectId, chatMode, chatRoster],
  );

  /**
   * Start a run on `id`: the request this hook builds, with the host's run-time parts
   * (`prepareRun`) laid over it. Resolves when the run settles, or at once when
   * `prepareRun` refuses (its message becomes the conversation's error).
   */
  const launch = useCallback(async (id: number, request: BrainRunRequest): Promise<void> => {
    launchingRef.current.add(id);
    try {
      let extra: Partial<BrainRunRequest> | null = null;
      if (prepareRun) {
        try {
          extra = await prepareRun(id);
        } catch (e) {
          if (chatIdRef.current === id) setLocalError(e instanceof Error ? e.message : 'Could not start the run.');
          return;
        }
      }
      // A Stop while this run got ready (its send persisting, the host preparing): it never
      // starts, and an answer row says so — or a reopened chat would start it after all.
      if (cancelledLaunchRef.current.delete(id)) {
        const row = await stopBeforeStart(id, id, persistence);
        if (row) updateMessages(id, (prev) => [...prev, row]);
        return;
      }
      // Direction the run never reads becomes this chat's next turn, whichever chat is on screen.
      // Only where the run executes HERE: a host-driven run (the editor's webview) settles elsewhere.
      if (!getRunDriver()) continueOnSettle(id, persistence);
      await startRun(id, extra ? { ...request, ...extra } : request);
    } finally {
      launchingRef.current.delete(id);
      cancelledLaunchRef.current.delete(id);
    }
  }, [prepareRun, persistence, updateMessages]);

  const send = useCallback(
    async (text: string, opts?: { addressedTo?: DirectedRecipient | DirectedGroup | readonly DirectedRecipient[] | null; attachments?: ChatInputAttachment[] }): Promise<boolean> => {
      const trimmed = text.trim();
      // Busy only for THIS chat: a run in flight elsewhere never blocks this one.
      if (!trimmed || sendingRef.current.has(chatId) || isRunning(chatId)) return false;
      // A message addressed to a participant (an invited agent/human) is a chat
      // turn for THEM, not a directive for the BRAIN — persist it, but don't run
      // the agent loop. `null`/omitted means the BRAIN (existing behavior).
      const addressedTo = opts?.addressedTo ?? null;

      // Claimed before a draft's row exists, so a double-submit cannot mint two chats.
      const origin = chatId;
      markSending(origin, true);
      let id = chatId;
      if (id == null) {
        try {
          id = (await ensureChatId?.()) ?? null;
        } catch {
          id = null;
        }
        // A Stop while the draft's row was being created is this chat's Stop.
        const cancelled = cancelledLaunchRef.current.delete(origin);
        if (id == null) {
          markSending(origin, false);
          setLocalError('Could not start a chat.');
          return false;
        }
        if (cancelled) cancelledLaunchRef.current.add(id);
        markSending(id, true);
        markSending(origin, false);
      }
      const runChatId = id;
      const stillOpen = () => chatIdRef.current === runChatId || chatIdRef.current === origin;
      // Claim the auto-reply guard for this chat: a user-driven send must not be
      // re-answered by the trailing-user-message auto-reply effect.
      autoRepliedChatIdRef.current = id;

      // An explicit opts.attachments (a turn queued while the composer still held them —
      // by the time a queued turn sends, the composer snapshot has moved on) wins over
      // the live composer snapshot. Exactly this turn's OWN files leave the composer as the send
      // STARTS (by key: a held turn flushed while a new file is pending leaves that file where it
      // is, and one whose files already left is a no-op). A failed send puts back only the files
      // it took from the composer itself; a turn GIVEN its files is restored by whoever gave
      // them (`restoreAttachments`), which may instead keep the turn for later.
      const given = opts?.attachments !== undefined;
      const attachments = [...(opts?.attachments ?? pendingAttachments)];
      composer.take(attachments);
      setLocalError('');

      const addressedList = addressedTo == null
        ? null
        : Array.isArray(addressedTo)
          ? addressedTo
          : (addressedTo as DirectedRecipient | DirectedGroup).kind === 'group'
            ? (addressedTo as DirectedGroup).members
            : [addressedTo as DirectedRecipient];
      // Model-visible content: images as `image_url` vision parts (the gateway routes
      // these to a vision model), attachments the host can read inlined as text under
      // the mention budget, anything else a link (`attachmentContent.ts`). Resolved BEFORE
      // the persist: the row records the text the model read, so the next run's
      // transcript, a retry and a reload re-send it (`attachmentTranscript.ts`). Never rejects.
      // Persisted/display content stays text-only (the chat tables store a string): every
      // attachment shows as a link the user can click. The ONE composition (`composeUserTurn`).
      const { displayContent, turn } = await composeUserTurn(trimmed, attachments, persistence);
      const metadata = withDirectedMetadata(addressedList, turn.meta);

      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: 'user', content: displayContent, metadata }]);
        updateMessages(id, (prev) => [...prev, userMsg]);
        onActivity?.(id);
        // First user turn of this chat → let the host auto-name it from the topic
        // (so it stops reading "New chat"). Uses the raw typed text, not the
        // attachment-decorated display content.
        if (messages.length === 0) onFirstUserTurn?.(id, trimmed);
        // Addressed to a participant, not the BRAIN: the turn is posted to the
        // chat (visible to everyone) and the BRAIN loop stays idle. The auto-reply
        // guard was already claimed above, and the effect below also skips it, so
        // a later reload won't answer it either.
        if (addressedTo) {
          // An @agent participant actually answers: a chat-scoped run replies AS
          // that agent and posts an assistant turn attributed to it. A group turn
          // fans out to every agent member. A @human just gets the posted turn
          // (they'll be notified out-of-band). Missing requestAgentReply used to
          // skip silently, so the user saw their message and nothing answered.
          const agents = directedAgentRecipients(addressedTo);
          if (agents.length > 0) {
            if (!persistence.requestAgentReply) {
              if (stillOpen()) setLocalError('This session cannot ask an agent to reply.');
            } else {
              for (const agent of agents) {
                try {
                  const reply = await persistence.requestAgentReply(id, { agentRef: agent.ref, agentName: agent.name });
                  if (reply) {
                    updateMessages(id, (prev) => (reply.id != null && prev.some((m) => m.id === reply.id) ? prev : [...prev, reply]));
                    onActivity?.(id);
                  }
                } catch (e) {
                  if (stillOpen()) setLocalError(e instanceof Error ? e.message : 'The agent could not reply.');
                }
              }
            }
          }
          return true;
        }
        // A stop with nothing running is kept as the person's answer and starts nothing (an
        // attachment is work: the reload reads the text with its links, so it runs too); a
        // Stop pressed while this send got ready drops the launch.
        const runs = attachments.length > 0 || startsRun(trimmed);
        if (runs) await launch(id, buildRequest(messages, messages, turn.content, userMsg?.id));
        return true;
      } catch (e) {
        // Persisting the user turn failed (commonly an expired token) — the turn
        // was NOT saved. Restore the attachments too so the whole message can be
        // resent, and signal failure so the composer keeps the typed text.
        // The files go back to the composer that is SHOWING, switched away or not - the same place the
        // host puts the typed text back (the false return) - so a message is never half-restored.
        if (!given) composer.restore(attachments);
        if (stillOpen()) setLocalError(e instanceof Error ? e.message : 'Send failed');
        return false;
      } finally {
        cancelledLaunchRef.current.delete(runChatId);
        markSending(runChatId, false);
      }
    },
    [persistence, chatId, markSending, composer.take, composer.restore, pendingAttachments, messages, ensureChatId, buildRequest, launch, onActivity, onFirstUserTurn, updateMessages],
  );

  const replyToTrailingTurn = useCallback((id: number, last: BrainMessage) => {
    setLocalError('');
    void launch(id, buildRequest(messages.slice(0, -1), messages, userTurnContentOf(last), last.id));
  }, [messages, buildRequest, launch]);
  useAutoReplyTrailingTurn({ chatId, loadingMessages, localSending, messages, repliedRef: autoRepliedChatIdRef, reply: replyToTrailingTurn });

  const retryLastTurn = useCallback((): boolean => {
    if (chatId == null || sendingRef.current.has(chatId) || isRunning(chatId)) return false;
    const index = unansweredTurnIndex(messages);
    if (index < 0) return false;
    const turn = messages[index];
    // A turn for a participant is theirs to answer, never the Brain's.
    if (isDirectedToParticipant(turn)) return false;
    autoRepliedChatIdRef.current = chatId;
    setLocalError('');
    clearRunError(chatId);
    void launch(chatId, buildRequest(messages.slice(0, index), messages, userTurnContentOf(turn), turn.id));
    return true;
  }, [chatId, messages, buildRequest, launch]);

  const rateMessage = useCallback(async (msg: BrainMessage, rating: 1 | -1 | 0) => {
    // Optimistic: the thumb reacts immediately; a failed write only loses telemetry.
    setRatings((prev) => withRating(prev, msg.id, rating));
    // Derived from the transcript, not from the composer's current state: the model
    // is whatever the gateway actually resolved for THIS reply (after any failover),
    // and the tool is the one the turn executed.
    const context = ratedTurnContext(messagesRef.current, msg.id);
    // E5: a thumb on the chat's latest reply is the `rating` verdict on that turn's
    // deferred local-success label — resolved here, where the web Brain and Rovr run
    // their model stream (a no-op when nothing local is waiting). The VS Code host
    // resolves it on its own side from `localVerdict` (its stream lives there).
    const localVerdict = localRatingVerdict(messagesRef.current, msg.id, rating, chatId);
    if (localVerdict) submitLocalTurnVerdict(localVerdict.chatId, localVerdict.passed);
    try {
      await persistence.setMessageFeedback(
        msg.id,
        rating === 1 ? 'up' : rating === -1 ? 'down' : null,
        { toolName: context.toolName, ...(localVerdict ? { localVerdict } : {}) },
      );
    } catch { /* best-effort */ }
  }, [persistence, chatId]);

  const resolveConfirm = useCallback((ok: boolean) => {
    if (chatId != null) resolveRunConfirm(chatId, ok);
  }, [chatId]);

  const clearError = useCallback(() => {
    setLocalError('');
    clearRunError(chatId);
  }, [chatId]);

  const stop = useCallback(() => {
    if (chatId == null) {
      // A draft's first send is still creating its chat: the launch is dropped once it has one.
      if (sendingRef.current.has(null)) cancelledLaunchRef.current.add(null);
      return;
    }
    // A send still getting ready has no run to stop yet: its launch is dropped instead.
    if ((sendingRef.current.has(chatId) || launchingRef.current.has(chatId)) && !isRunning(chatId)) cancelledLaunchRef.current.add(chatId);
    stopRun(chatId);
  }, [chatId]);

  const buildTriageReport = useCallback(
    (agentLabel?: string, surface?: string) =>
      buildBrainTriageReport({
        capturedAt: new Date().toISOString(),
        events: getRunTrace(chatId),
        messages,
        chatId,
        agentLabel,
        surface,
        configuredModel: model,
        error: localError || snapshot.error,
      }),
    [chatId, messages, localError, snapshot.error, model],
  );

  const contextUsage = useMemo(() => contextUsageOf(messages, snapshot.trace), [messages, snapshot.trace]);

  return {
    messages,
    loadingMessages,
    reloadMessages,
    sending: localSending || snapshot.running,
    error: localError || snapshot.error,
    /** What the user can DO about `error` (reconnect / upgrade / add a card), when
     *  the failure was actionable. Only meaningful for a RUN error — a local error
     *  (e.g. a failed rename) has no gateway verdict behind it. */
    errorAction: localError ? null : snapshot.errorAction,
    streamingText: snapshot.streamingText,
    activity: snapshot.activity,
    ratings,
    pendingAttachments,
    uploading,
    send,
    retryLastTurn,
    stop,
    rateMessage,
    attach: composer.attach,
    removeAttachment: composer.remove,
    restoreAttachments: composer.restore,
    setError: setLocalError,
    clearError,
    pendingConfirm: snapshot.pendingConfirm,
    resolveConfirm,
    hasTrace: snapshot.hasTrace,
    trace: snapshot.trace,
    contextUsage,
    /** Connected providers the gateway couldn't use this run (e.g. an expired Claude
     *  subscription) — a mounted view renders a passive "reconnect your account"
     *  banner off this. Empty when everything resolved. */
    byoUnresolved: snapshot.byoUnresolved,
    providerCap: snapshot.providerCap,
    buildTriageReport,
  };
}
