/**
 * What decides, per tool call, whether the host's runner is reached - run by the agent's platform tools
 * (`run/brainPlatformTools.ts`). Everything that decides, per tool call, whether the
 * host's runner is reached at all and with what: the tool router, the conversational
 * `ask_user` / `hand_off` tools, the one-ticket-per-run attach, the run's chat stamped
 * onto a server create, the human confirm gate,
 * and the read de-duplication / covered-read / derived-search / repeated-write guards.
 */

import { ASK_USER_TOOL, MID_TURN_META_KEY, type LoopHooks } from '@builderforce/agent-loop';
import { offersHandOff } from '@builderforce/run-policy';
import { resolveToolAlias } from '@builderforce/agent-tools';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isFailedToolResult } from '../brainTriage';
import { isRouterTool, handleRouterCall } from '../toolRouter';
import { handOffTrace } from '../runPolicyTraces';
import { FAN_OUT_TOOL, HAND_OFF_TOOL, executeHandOff, parseHandOff } from '../planHandoff';
import { HAND_OFF_CLASH_LABEL, HAND_OFF_MODE_LABEL, handOffModeSentence, planScopeClash, scopeClashCorrective } from '../handOffParallelism';
import { codeChangesOf } from '../codeChanges';
import { delegationPlaceholders } from '../placeholderGuard';
import { undelegatedRequestNudge } from '@builderforce/agent-run';
import { visitTarget } from '../runActivity';
import { repeatedWriteNote, revisitAdvisory } from '@builderforce/run-guards';
import { requestedReadWindow, trimToolResult } from '../toolResultBudget';
import { stillInWorkingContext } from '@seanhogg/builderforce-memory/working';
import { emit, nowIso, nowMs, pushTrace, recordAppended } from './runCells';
import { requestRunConfirm } from './runControl';
import { createLinkedToChat, isTicketRecordingTool, stampRunChat } from '../chatWorkLinking';
import { attachDeltaToRunTicket } from './runBackstops';
import { isPublishCall, publishHoldRefusal } from './publishHold';
import { shipGatePreflight } from './shipGates';
import { isDedupableRead, reportToPolicy, type BrainRunContext } from './brainRunContext';

/**
 * The ONE `tools.routed` step: a call that reached a tool the turn did not advertise, through the router (`via` = the router tool) or
 * directly (`via` = `'direct'`: the surface's catalog is closed, so the call ran as a router `invoke` would, `run/brainPlatformTools.ts`).
 */
export function traceRouted(c: BrainRunContext['c'], step: number, via: string, name: string): void {
  pushTrace(c, {
    ts: nowIso(),
    category: 'message',
    label: 'tools.routed',
    args: { step, via },
    result: via === 'direct'
      ? `Called ${name} directly (it was not advertised this turn), so it ran as a tool-router call.`
      : `Called ${name} through the tool router (it was not advertised directly this turn).`,
  });
}

export function callPreflight(run: BrainRunContext): NonNullable<LoopHooks<ChatCompletionMessage>['beforeDispatch']> {
  const { c, chatId, runKey, req, allTools, catalogToolNames, usedTools, readCoverage, writeLedger, placeholderLedger } = run;
  const { runTool, needsConfirm, persistence } = req;
  return async (rawCall, ctx) => {
    const iter = ctx.step;
    // This call starts clean: only ITS entry, never a sibling's still in flight (D8 batches run concurrently).
    run.pending.forget(rawCall.id);
    // Router calls resolve against the in-memory catalog FIRST. `find`/`describe`
    // are answered locally (no network, no host dispatch); `invoke` unwraps to the
    // real tool and then falls through to the normal path below — so a routed call
    // still passes the confirm gate, the read-dedupe, the audit step and the
    // chat stamp, exactly like a directly-advertised one.
    let call = rawCall;
    // Common hallucinations (list_dir → list_files, …) remapped once here so every
    // host's runTool sees the catalog name — confirm, dedupe, activity and dispatch
    // all agree.
    {
      const aliased = resolveToolAlias(call.name);
      if (aliased !== call.name) call = { ...call, name: aliased };
    }
    if (isRouterTool(call.name)) {
      const routed = handleRouterCall(allTools ?? [], call.name, call.args);
      if ('result' in routed) {
        pushTrace(c, {
          ts: nowIso(),
          category: 'tool',
          label: call.name,
          args: call.args,
          result: routed.result,
        });
        return { result: { data: routed.result } };
      }
      const routedArgs = routed.dispatch.args ?? {};
      call = { ...call, name: routed.dispatch.name, args: routedArgs, raw: { ...call.raw, name: routed.dispatch.name, arguments: JSON.stringify(routedArgs) } };
      traceRouted(c, iter, rawCall.name, call.name);
    }
    // `ask_user` never reaches the host's tool runner — it is not a workspace action,
    // and `beforeToolCalls` has already settled every WELL-FORMED question as the
    // run's reply. Reached only when the args were malformed AND the model wrote no
    // prose to fall back on, so the answer is a corrective result: the call is not
    // left unanswered, and the model is told exactly how to retry.
    if (call.name === ASK_USER_TOOL) {
      if (run.redirectAskToDelegation) {
        run.redirectAskToDelegation = false;
        return { result: { data: { ok: false, error: undelegatedRequestNudge(catalogToolNames) } } };
      }
      // Auto-mode: `beforeToolCalls` resolved the host's `answerQuestion` for this well-formed
      // question — return the answer as the call's result so the run continues with it as the
      // next user turn instead of stalling on the question card.
      if (run.pendingAskAutoAnswer !== undefined) {
        const answer = run.pendingAskAutoAnswer;
        run.pendingAskAutoAnswer = undefined;
        return { result: { data: { ok: true, answer } } };
      }
      return { result: { data: { error: 'ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose.' } } };
    }
    // PLANNING ENDS HERE. The planner's tasks become tickets linked to this chat and
    // are handed to the coding model — side by side, one coding child per task, where
    // the host can fan out and the tasks own disjoint paths; otherwise in order, by the
    // coder this run becomes. The result tells the coder which (see `planHandoff.ts`).
    if (call.name === HAND_OFF_TOOL) {
      if (!offersHandOff(run.policy)) {
        // Two ways planning is over: a real hand-off already ran, or the run started
        // editing (a pinned/locked model's edit in this same batch). Only the first filed tickets.
        const error = usedTools.has(HAND_OFF_TOOL)
          ? 'The plan was already handed off — you are the coding model now. Implement the tasks; do not re-plan.'
          : 'This run has already started editing, so it is coding now and hand_off is closed. Implement the work directly; use spawn_agents for separate slices that own disjoint files.';
        return { result: { data: { ok: false, error } } };
      }
      const plan = parseHandOff(call.args);
      if (typeof plan === 'string') return { result: { data: { ok: false, error: plan } } };
      // Overlapping slices cannot run side by side. Where the host can fan out, the planner is
      // told ONCE which two tasks clash and on what path, so it can narrow them (chat #70776: a
      // parent directory sent four tasks inline). Nothing is filed and the role stays; a second
      // overlapping plan is carried out as is. Never on a FORCED hand-off turn: the run gets one,
      // and a refusal there would end planning with nothing filed (`planBudgetTurn`).
      const clash = !run.handOffClashRefused && !run.policy.handOffForced && new Set(catalogToolNames).has(FAN_OUT_TOOL)
        ? planScopeClash(plan.tasks)
        : null;
      if (clash) {
        run.handOffClashRefused = true;
        const error = scopeClashCorrective(clash);
        pushTrace(c, { ts: nowIso(), category: 'message', label: HAND_OFF_CLASH_LABEL, args: { step: iter, ...clash }, result: error });
        return { result: { data: { ok: false, error } } };
      }
      // The role flips BEFORE the children start: they and every later turn are code.
      reportToPolicy(run, { type: 'hand_off' });
      pushTrace(c, handOffTrace(nowIso(), ctx.step, plan.tasks.length, HAND_OFF_TOOL));
      const outcome = await executeHandOff(plan, {
        // A hand-off ticket links to this chat in its create call, stamped like a model's.
        runTool: (name, args) => {
          stampRunChat(name, args, run.serverChatId);
          return runTool!(name, args);
        },
        toolNames: new Set(catalogToolNames),
        // The research the coders inherit: what this planning run read and searched.
        knowledge: run.knowledge.brief(),
        // …and the goal, in the user's words: a child sees none of this conversation.
        request: run.goal,
        ...(req.projectId != null ? { projectId: req.projectId } : {}),
        afterCreate: async (toolName, out) => {
          // A hand-off ticket filed with the editor's own create tool, or a server create
          // linked to this chat in its own call, is recorded work too.
          if (isTicketRecordingTool(toolName) || createLinkedToChat(toolName, out)) c.ticketRecorded = true;
        },
        step: (label, args, out, durationMs) => pushTrace(c, {
          ts: nowIso(), category: 'tool', label, durationMs, args, result: out ?? null, isError: isFailedToolResult(out),
        }),
        // How the plan ran — side by side, inline or mixed, and the overlap that decided it —
        // so the diagnostics report can say why tasks did not run as sub-agents.
        decided: (decision) => pushTrace(c, {
          ts: nowIso(), category: 'message', label: HAND_OFF_MODE_LABEL, args: { step: iter, ...decision }, result: handOffModeSentence(decision),
        }),
        postPlan: async (text) => {
          const [msg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: text, metadata: JSON.stringify({ [MID_TURN_META_KEY]: true }) }]);
          if (!msg) return;
          recordAppended(c, msg);
          emit(c);
        },
        now: nowMs,
      });
      // The children's writes happened inside their own loops; the code-change backstop
      // reads them off the result, exactly as it does for `spawn_agents`.
      const changed = codeChangesOf(HAND_OFF_TOOL, call.args, outcome);
      if (changed) {
        c.codeChanged = true;
        for (const f of changed) if (!c.touchedFiles.includes(f)) c.touchedFiles.push(f);
      }
      usedTools.add(HAND_OFF_TOOL);
      placeholderLedger.add(delegationPlaceholders(outcome));
      return { result: { data: outcome as unknown as Record<string, unknown> } };
    }
    const args = call.args;
    // ONE ticket per run. The run opens its own delta ticket on the first edit
    // (see below), and the model — following the same directive, from the other
    // end — often records the delta too. Left alone that is two tickets for one
    // change, which is worse on the board than the missing ticket this all exists
    // to prevent. `from_delta` already takes `taskId` to attach rather than mint,
    // so the model's call is pointed at the ticket the run has: the deterministic
    // form of the advice the directive gives it in prose.
    attachDeltaToRunTicket(call.name, args, c.deltaTicketId);
    // The chat a server create links its item to is the RUN's fact, never the model's:
    // stamped here — before the confirm gate, the trace and the dispatch — so the server
    // links the item to this conversation in the create call itself.
    stampRunChat(call.name, args, run.serverChatId);
    // PUBLISH HOLD (incident #56886): refuse commit / push / PR calls BEFORE the confirm
    // gate, so neither `acceptEdits` nor a sub-agent's inherited context can waive it.
    // The hold is the ROOT chat's (the run's own transcript IS the root's when seeded),
    // so a child can never lift its owner's hold. The model gets a recoverable refusal
    // naming the exact user turn that set it.
    if (c.publishHold && isPublishCall(call.name, args)) {
      const refusal = publishHoldRefusal(c.publishHold);
      pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: { publishHold: c.publishHold.messageNumber, note: refusal.error } });
      return { result: { data: refusal } };
    }
    // SHIP GATES (PRD 45 §4.5): a base-branch push, a pull request, a `complete` review
    // record — refused on failing evidence or no independent review, WITHOUT asking the
    // human. Inert unless the host bound the ports; a pass hands the prompt its evidence.
    const ship = await shipGatePreflight(run, call.name, args);
    if ('refusal' in ship) {
      pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: ship.refusal, isError: true });
      return { result: { data: ship.refusal } };
    }
    // Human-in-the-loop gate: pause for an explicit confirm when the host's
    // predicate says so. The resolver lives on the cell, so whichever Brain
    // instance is mounted (even after a navigation swapped it) can answer.
    if (needsConfirm && needsConfirm({ name: call.name, args })) {
      // The prompt belongs to THIS run's cell — a sub-agent asks on its own, named.
      const ok = await requestRunConfirm(runKey, { name: call.name, args, ...(ship.evidence ? { evidence: ship.evidence } : {}) }, { step: iter });
      if (!ok) {
        const declined = { cancelled: true, reason: 'User declined this action.' };
        pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: declined });
        return { result: { data: declined } };
      }
    }
    // Read-dedupe: suppress an EXACT repeat of a read-only file/search OR read-only
    // platform call (its result is already above). Any other call invalidates what
    // it could have changed — and ONLY that (see `ReadCoverage.invalidate`): an edit
    // forgets its own file, a platform write forgets the platform reads, a git status
    // forgets nothing. The old set was cleared wholesale by every non-read call, so
    // one ticket write re-armed a full re-read of every file in the run.
    if (isDedupableRead(call.name)) {
      if (readCoverage.isRepeat(call.name, args)) {
        // The stub below is only honest while the earlier result is still in the
        // WORKING context. Once auto-compaction has summarized it away, "it is
        // above you" points at nothing — the model reads that as "I lack the
        // file", asks again, gets the stub again, and circles (chat #101: five
        // stubbed re-reads of one file, zero edits). So the run keeps what each
        // read returned and, when the carrying message has left the window,
        // RE-SERVES it from memory: no disk read, no lie, and the model can act.
        const cached = readCoverage.cachedResult(call.name, args);
        if (cached && !stillInWorkingContext(c, cached.anchor)) {
          const replayNote = `Replayed from this run's read cache: this exact ${call.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again — served from memory, not re-read. Act on it now; do not request it again.`;
          // A replay is still the model going back to the same target, so it
          // counts as a visit and carries the circling advisory when it earns one.
          const visit = readCoverage.record(call.name, args);
          const target = visit ? visitTarget(args) : undefined;
          const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
          const replayed = trimToolResult(call.name, cached.result ?? null, {
            advisory: revisit ? `${replayNote}\n\n${revisit}` : replayNote,
            contextWindowTokens: await run.windowFit.contextWindow?.(),
          });
          run.pending.replayed(call.id, { name: call.name, args, result: cached.result, served: replayed.served });
          pushTrace(c, {
            ts: nowIso(),
            category: 'tool',
            label: call.name,
            args,
            result: { replayed: true, note: replayNote },
            resultBytes: replayed.bytes,
            truncated: replayed.truncated,
          });
          run.cacheStreak.served(iter);
          return { result: { data: replayed.content } };
        }
        const stub = {
          note: `Duplicate ${call.name} call — identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`,
        };
        pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: stub });
        run.cacheStreak.served(iter);
        return { result: { data: stub } };
      }
      // A `read_file` window fully inside an earlier successful window of the same
      // file (chat #109: fourteen overlapping offsets of one service file). Different
      // exact-repeat keys, same bytes. Stub while the covering result is still in
      // context; replay it from cache once compaction has dropped it. See
      // `ReadCoverage.coveredRead`. A jump to uncovered lines still runs.
      const covered = readCoverage.coveredRead(call.name, args);
      if (covered) {
        const visit = readCoverage.record(call.name, args);
        const target = visit ? visitTarget(args) : undefined;
        const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
        const note = revisit ? `${covered.note}\n\n${revisit}` : covered.note;
        if (covered.cached && !stillInWorkingContext(c, covered.cached.anchor)) {
          // The REQUESTED window, cut from the covering read's full result — not that
          // read's own window from its first line (PRD 35 E1).
          const requested = requestedReadWindow(covered.cached.result ?? null, covered.start, covered.end);
          const replayed = trimToolResult(call.name, requested, { advisory: note, contextWindowTokens: await run.windowFit.contextWindow?.() });
          run.pending.replayed(call.id, { name: call.name, args, result: requested, served: replayed.served });
          pushTrace(c, {
            ts: nowIso(),
            category: 'tool',
            label: call.name,
            args,
            result: { covered: true, replayed: true, note },
            resultBytes: replayed.bytes,
            truncated: replayed.truncated,
          });
          run.cacheStreak.served(iter);
          return { result: { data: replayed.content } };
        }
        const stub = { note };
        pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: { covered: true, note } });
        run.cacheStreak.served(iter);
        return { result: { data: stub } };
      }
      // A narrower search whose answer is already held: the same query run earlier
      // over an ancestor directory, complete. Served by filtering that result — the
      // same bytes a re-run would return — and cached like any read so a repeat of it
      // is an exact repeat. See `ReadCoverage.derivedSearch`.
      const derived = readCoverage.derivedSearch(call.name, args);
      if (derived) {
        const visit = readCoverage.record(call.name, args);
        const target = visit ? visitTarget(args) : undefined;
        const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
        const served = trimToolResult(call.name, derived, { advisory: revisit, contextWindowTokens: await run.windowFit.contextWindow?.() });
        run.pending.replayed(call.id, { name: call.name, args, result: derived });
        pushTrace(c, {
          ts: nowIso(),
          category: 'tool',
          label: call.name,
          args,
          result: { derived: true, note: derived.note },
          resultBytes: served.bytes,
          truncated: served.truncated,
        });
        return { result: { data: served.content } };
      }
    } else {
      if (writeLedger.isRepeat(call.name, args)) {
        const note = repeatedWriteNote(call.name, String((args as { path?: unknown }).path ?? '').trim());
        pushTrace(c, { ts: nowIso(), category: 'message', label: 'tools.repeat_write_guard', args: { step: iter, tool: call.name }, result: note });
        pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: { skipped: true, note } });
        run.cacheStreak.served(iter);
        return { result: { data: { ok: true, applied: false, unchanged: true, note } } };
      }
      readCoverage.invalidate(call.name, args);
    }
    return call === rawCall ? undefined : { rewrite: call };
  };
}
