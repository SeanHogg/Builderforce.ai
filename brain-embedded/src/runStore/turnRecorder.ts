/**
 * What a COMPLETED turn leaves on the run, recorded ONCE: the coder the outcome grades, the BYO banners, the run's usage,
 * the serving model, the downgrade and local-first traces, and the durable `llm.complete` step (plus the turn's visible
 * text) every diagnostics reader keys on. Extracted from `completeTurn.ts` so the Brain's own loop and the agent's model
 * port (`run/modelTransport.ts`) record a turn the same way - never a copy.
 *
 * It RECORDS and decides nothing: the model policy's report of the turn, the window fit and the stall counters stay with
 * the engine that owns them.
 */

import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { servedOnDevice } from '@builderforce/local-inference';
import type { BrainToolSpec, StreamChatResult } from '../streamChatCompletion';
import { setLastResolvedModel } from '../lastResolvedModel';
import { localFallbackTrace } from '../localFirstTraces';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { toolCallArgBytes } from '../composingActivity';
import { hasCallMarkup } from '../xmlToolCalls';
import { turnInterruption } from '../finishReason.js';
import { accrueByoUnresolved, accrueProviderCap, nowIso, nowMs, pushTrace, runTrace } from './runCells';
import { modelDowngradeEvent } from './modelDowngrade';
import { gatewayRoutingArgs } from './gatewayRoutingTrace';
import type { LiveTurn } from './turnStream';
import type { RunLoopContext, TurnMeta } from './runLoopContext';

/** One completed turn, as the engine that asked for it saw it. */
export interface RecordedTurn {
  result: StreamChatResult;
  /** The turn's number in the run. */
  iter: number;
  /** When the completion was opened. */
  llmStart: number;
  /** The turn's live view (its first-token time). */
  live: Pick<LiveTurn, 'firstTokenAt'>;
  /** The role the turn asked the gateway as (analysis, code, chat). */
  role: string;
  /** The model that answered, and the one that was asked for (`default` when the gateway chose). */
  resolved: string;
  requested: string;
  /** The tools the turn was OFFERED. */
  advertised: readonly BrainToolSpec[];
  advertisedNames: ReadonlySet<string>;
}

/** Record turn `t` on the run's cell, trace and usage, and return the facts the final-answer path reads. */
export async function recordTurn(run: RunLoopContext, t: RecordedTurn): Promise<TurnMeta> {
  const { c, chatId, allTools } = run;
  const { result, iter, llmStart, role, resolved, requested, advertised } = t;
  const advertisedNames = t.advertisedNames as Set<string>;
  const firstTokenAt = t.live.firstTokenAt();
  // The model making the code changes is the one this run's outcome grades as a
  // coder — after a hand-off the coding model, under a pin the pinned one.
  if (result.resolvedModel && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))) c.codeModel = result.resolvedModel;
  // Surface a connected-but-unresolved BYO account for a live banner (and reset
  // clears it when the account is reconnected). Emit happens with the trace below.
  accrueByoUnresolved(c, result.byoUnresolved);
  // Surface any BYO provider usage cap so the user knows to manage their keys.
  accrueProviderCap(c, result.providerCap);
  // Silent-downgrade detection: the gateway can fail over mid-run to a
  // different (often smaller-window) model than we requested. That's a prime
  // context-exhaustion symptom, so surface it as its own warning step instead
  // of leaving it buried in the model field — the diagnostics block counts it.
  // The run's production cost so far — what its answer is cached with, and the model
  // a later memory answer in this chat is priced against.
  c.runUsage.promptTokens += result.usage?.prompt ?? 0;
  c.runUsage.completionTokens += result.usage?.completion ?? 0;
  if (result.resolvedModel) {
    c.runUsage.model = result.resolvedModel;
    c.lastServedModel = result.resolvedModel;
  }
  // Record what ACTUALLY served this turn so `builtin_session_current_model` can
  // report the exact model (an MCP call is a separate request and can't see it).
  // Keyed by CHAT: runs are concurrent on a host that owns them, so one slot would
  // let this chat's tool call answer with the model that served a different one.
  setLastResolvedModel(chatId, result.resolvedModel);
  // A pinned model answered by another, or an auto-routed turn the tenant's own
  // account could not serve, or an auto-routed PLAN turn on a Flash-class model
  // (PRD 35 E7) — see `modelDowngrade.ts`.
  const downgrade = modelDowngradeEvent({
    requested, resolved, step: iter, ts: nowIso(), events: runTrace(c), planPhase: !c.codeChanged,
    ...(result.byoUnresolved ? { byoUnresolved: result.byoUnresolved } : {}),
  });
  if (downgrade) pushTrace(c, downgrade);
  // A local-first turn that fell over (on-device model down/refused → the cloud).
  const localFallback = localFallbackTrace(nowIso(), iter, result.localFirst);
  if (localFallback) pushTrace(c, localFallback);
  // Tool names this turn WROTE OUT as prose while emitting no structured call, that
  // were never advertised to it. Computed here because this is the only place that
  // holds BOTH the turn's text and the exact set the turn was offered — after the
  // fact a reader can only see the catalog total, which is why "the model is broken,
  // pick another one" was the standing (and sometimes wrong) verdict for a run whose
  // real fault was that the tool it was told to call had been selected away. Cheap:
  // a handful of strings, and empty on every healthy turn.
  const narratedUnadvertised =
    result.toolCalls.length === 0
      ? toolNamesMentionedIn(result.text).filter((n) => !advertisedNames.has(n))
      : [];
  // Bytes of tool-call arguments this turn emitted — taken from the ASSEMBLED calls,
  // so a turn retried after a stream break reports what the surviving attempt sent.
  const argBytes = toolCallArgBytes(result.toolCalls);
  // The serving model's window (resolved once per model per run), so the composer's
  // context meter reads this turn's prompt against it — `contextUsageOf`.
  const contextWindow = await run.windowFit.contextWindow?.();
  // DURABLE, not just live: an `llm` turn carries the token usage, finish reason
  // and resolved model the A-vs-B triage runs on. Kept in memory only, a chat
  // copied after a reload reported `Turns: 0` / "Tokens: not reported" and could
  // never separate context exhaustion from model degradation. The payload is a
  // handful of scalars — no transcript text — so the row stays small.
  pushTrace(c, {
    ts: nowIso(),
    category: 'llm',
    label: 'llm.complete',
    durationMs: nowMs() - llmStart,
    ttftMs: firstTokenAt !== undefined ? firstTokenAt - llmStart : undefined,
    // `model` is the model the gateway ACTUALLY used (resolved), falling back to
    // what we requested when the gateway didn't report one. `requestedModel`
    // keeps the caller's ask (empty/'default' ⇒ gateway auto-selects) so triage
    // can tell "what I asked for" from "what answered".
    args: {
      model: resolved,
      requestedModel: requested,
      step: iter,
      // What the turn asked the gateway for (analysis vs code vs chat), so a copied
      // report shows which model planned and which one wrote the code.
      role,
      toolCalls: result.toolCalls.length,
      // How much the turn actually EMITTED. "1 tool call(s) · 202509ms" said
      // nothing about a turn that spent three minutes streaming 21 KB of
      // `write_file` arguments — which is what a long turn usually is.
      ...(argBytes > 0 ? { argBytes } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      // Which account served the turn + any connected-BYO provider the gateway
      // could NOT resolve — so triage tells "ran on the shared pool despite a
      // connected Claude account (expired?)" apart from "nothing connected".
      account: result.account,
      // A turn answered on this machine cost nothing: reported as 0 explicitly. Any other turn carries NO cost
      // (unknown, never free) - the run's total is decided over all of them (`codeRunOutcome`).
      ...(servedOnDevice(result) ? { costMc: 0 } : {}),
      byoUnresolved: result.byoUnresolved,
      // How the gateway ROUTED the turn: the candidates it walked and every model it
      // tried and left (`model:status kind`). The only record of why a coding turn
      // landed where it did — a connected coder never seeded reads differently from
      // one seeded and refused.
      ...gatewayRoutingArgs(result.gateway),
      // How many tools the turn was actually OFFERED, out of the whole catalog.
      // A zero here is the difference between "the model refused to act" and "it had
      // nothing to act with" — previously unanswerable from a copied report, which
      // only ever carried the registry-wide total.
      advertisedTools: advertised.length,
      catalogTools: allTools?.length ?? 0,
      ...(narratedUnadvertised.length ? { narratedUnadvertised } : {}),
      // The stream filter strips every call it lifts, so call markup still IN the text
      // is a dialect it does not know: the model tried to act and the call never ran.
      // Recorded so a copied report says "parser gap" instead of "won't call tools".
      ...(result.toolCalls.length === 0 && hasCallMarkup(result.text) ? { unliftedCallMarkup: true } : {}),
      // What the vendor's RAW response carried, counted before the gateway translated
      // it — so a text-only turn reads as "the model returned no call" or "a returned
      // call was lost on the way", never as a guess. Absent when the vendor does not report it.
      ...(result.upstream ? { upstreamFunctionCalls: result.upstream.functionCalls, upstreamRecovered: result.upstream.recovered } : {}),
    },
    // Structured diagnostics fields — the A-vs-B triage reads these directly.
    usage: result.usage,
    finishReason: result.finishReason,
    textChars: result.text.length,
    result: `${result.toolCalls.length} tool call(s) · ${result.text.length} chars · finish: ${result.finishReason ?? '—'}${result.usage?.prompt != null ? ` · prompt ${result.usage.prompt} tok` : ''}`,
  });
  if (result.text.trim()) {
    pushTrace(c, { ts: nowIso(), category: 'message', label: 'agent.message', args: { step: iter }, result: result.text });
  }
  run.lastTurnInterruption = turnInterruption(result.finishReason);
  const meta: TurnMeta = { result, resolved, requested, advertised: advertised.length, advertisedNames };
  return meta;
}
