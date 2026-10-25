/**
 * The loop's TOOL port — runs one call on the host: refuses a call whose arguments
 * never parsed, records what it changed (opening the run's ticket on its first edit),
 * links what it created, and attaches the guards' advisories to the copy of the result
 * the model reads (repeated failure, placeholders, an unshipped completion, circling).
 */

import { malformedCallOutcome, malformedCallLabel, type LoopPorts } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { isFailedToolResult } from '../brainTriage';
import { withObservedModel } from '../lastResolvedModel';
import { isTicketRecordingTool } from '../chatWorkLinking';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { codeChangesOf, isDelegationTool } from '../codeChanges';
import { delegationPlaceholders, placeholderAdvisory, placeholdersWritten, placeholderTraceEvent } from '../placeholderGuard';
import { canCompleteTicket, completionAdvisory, isTicketCompletion, notOnBaseBranchAdvisory } from '../completionGuard';
import { shippedToBaseBranch } from '../shipVerification';
import { toolActivity, visitTarget } from '../runActivity';
import { revisitAdvisory, withAdvisory } from '@builderforce/run-guards';
import { isUnscopedMutation } from '../readCoverage';
import { trimToolResult } from '../toolResultBudget';
import { nowIso, nowMs, pushTrace, setActivity } from './runCells';
import { autoLinkCreatedItem, recordCodeChangeTicket } from './runBackstops';
import { failureAdvisoryFor, isDedupableRead, type RunLoopContext } from './runLoopContext';

export function dispatchToolPort(run: RunLoopContext): LoopPorts<ChatCompletionMessage>['dispatch'] {
  const { c, chatId, req, readCoverage, failures, writeLedger, placeholderLedger } = run;
  const { runTool } = req;
  return async (call, ctx) => {
    const iter = ctx.step;
    const args = call.args;
    // A call whose arguments never parsed is NOT run. The kernel's policy is that
    // bad JSON never aborts a run, so it hands the call over with `args: {}` and
    // `malformed: true` — and dispatching that anyway is how four 12 KB
    // `canvas_write_build_file` calls reached the tool with an empty bag and came
    // back "A path is required.", telling the model nothing about the real cause
    // (its response had hit the output ceiling) so it re-sent the same call until
    // the run was spent. Not counted as a tool failure: the tool never ran.
    const declined = malformedCallOutcome(call, run.lastTurnInterruption === 'truncated');
    if (declined) {
      const truncated = run.lastTurnInterruption === 'truncated';
      pushTrace(c, {
        ts: nowIso(), category: 'error', isError: true, durationMs: 0,
        label: malformedCallLabel(call.name, truncated),
        args: { arguments: String(call.raw?.arguments ?? '').slice(0, 200) },
        result: declined,
      });
      return { data: declined, isError: true };
    }
    const isReadTool = isDedupableRead(call.name);
    const toolStart = nowMs();
    // Name the tool AND what it is working on, before it runs. This is the
    // step that most often takes tens of seconds, and the one the trace could
    // never show until it was already over.
    setActivity(c, toolActivity(call.name, args, iter, Date.now()));
    // Unreachable: the model port advertises no tool calls without a runner.
    if (!runTool) throw new Error('tool call without a tool runner');
    let out: unknown;
    try {
      // The ONE place a tool call is told which model is serving THIS chat (see
      // `lastResolvedModel.ts`). Applied here rather than in a relay because this is
      // the only layer that knows both the conversation and the call — which is what
      // makes it work on every surface, instead of only the one relay that had a copy.
      out = await runTool(call.name, withObservedModel(chatId, call.name, args));
    } catch (e) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      out = { ok: false, error: message };
      // A throw is a failure like any other: the same call thrown three times is a
      // loop, not persistence, and the model needs to be told so on the result it
      // reads. The DURABLE step keeps the untouched error.
      const repeat = failureAdvisoryFor(run, call.name, args, out, iter);
      if (!isReadTool) writeLedger.record(call.name, args, { ok: false, unscoped: isUnscopedMutation(call.name, args) });
      run.pendingRun = { out, toolStart, isReadTool, threw: true };
      // Errors are small; push as-is (trimming a short error would only add noise).
      return { data: repeat ? withAdvisory(out, repeat) : out, isError: true };
    }
    // Backstop bookkeeping (see startRun's finally): a successful workspace
    // file-change marks the run as code-changing (and remembers the file), while
    // the model recording its own delta/link/review clears the need for the
    // auto-capture. `codeChangesOf` is the ONE reading of "what did this call
    // change" — a direct write names its path, a delegated child's writes arrive
    // as the `spawn_agent` result's `changedFiles` — and a failed direct write yields none.
    const changed = codeChangesOf(call.name, args, out);
    if (changed) {
      const first = !c.codeChanged;
      c.codeChanged = true;
      for (const f of changed) if (!c.touchedFiles.includes(f)) c.touchedFiles.push(f);
      // OPEN THE TICKET NOW, on the first edit — not in the `finally`, which a
      // Stop skips and a closed/reloaded surface never reaches. One call per run,
      // and from here on the work is on the board and linked to this chat whatever
      // becomes of the rest of the turn.
      if (first && !c.ticketRecorded && req.projectId != null && req.runTool) {
        await recordCodeChangeTicket(run.serverChatId, c, req, 'open').catch(() => { /* never fail the run on the backstop */ });
      }
    }
    if (isTicketRecordingTool(call.name)) c.ticketRecorded = true;
    // Deterministic traceability: whenever this turn CREATED a work item via an
    // MCP create tool (task/epic/gap, objective, spec, portfolio, initiative),
    // tie it to THIS conversation right now — instead of relying on the model to
    // remember the advisory builtin_chats_link_ticket call (which it often skips,
    // leaving the item created but orphaned from the chat). Fires the same shared
    // link tool the model would, tied to the run's resolved chatId.
    await autoLinkCreatedItem(run.serverChatId, c, runTool, call.name, out);
    // The MODEL transcript gets a size-capped copy so a big list result can't
    // flood the context window; the TRACE keeps the full result (bounded by
    // MAX_TRACE_EVENTS) for the timeline + triage copy, plus the pre-trim byte
    // size and a truncation flag the diagnostics block reads.
    // LOOP GUARD. A read that keeps circling the same target gets an advisory
    // attached to the copy the MODEL sees — the only moment it can act on the
    // fact that it is going round. The trace keeps the untouched result (the
    // timeline must show what the tool actually returned), and the intervention
    // is recorded as its own step so triage can see the loop was fought rather
    // than inferring it from the repetition alone.
    let advisory: string | null = null;
    if (!isReadTool) writeLedger.record(call.name, args, { ok: !isFailedToolResult(out), unscoped: isUnscopedMutation(call.name, args) });
    if (isFailedToolResult(out)) {
      // The OTHER loop the guards missed. `readCoverage` records successes only, by
      // design — a failed read has no result above to reuse, so a retry must not be
      // stubbed. That left an identical FAILING call with no pushback whatsoever:
      // the same `git_status` answered with the same "pass `repo`" remedy three
      // times, the same platform read answered 502 twice, the model repeating itself
      // each time. The first retry is still free; the second says so.
      advisory = failureAdvisoryFor(run, call.name, args, out, iter);
    } else {
      // It worked — earlier failures of this exact call were transient after all.
      failures.clear(call.name, args);
      // A write that SUCCEEDED can still be unfinished work: a stub, a TODO, the
      // model's own reasoning left in the source. Said on the result it reads — the
      // only moment it can still finish — and recorded for the diagnostics.
      const placeholders = placeholdersWritten(call.name, args);
      if (placeholders.length) {
        pushTrace(c, placeholderTraceEvent(call.name, placeholders, nowIso()));
        advisory = placeholderAdvisory(placeholders);
      }
      if (isCodeChangeTool(call.name)) placeholderLedger.record(call.name, args, placeholders);
      if (isDelegationTool(call.name)) placeholderLedger.add(delegationPlaceholders(out));
      // A ticket marked done while this run's placeholders are still in the code: said
      // at the moment the claim is made (chat #126 set #2747 done over a "For now" stub).
      // Also check that code is on the base branch before allowing completion.
      if (isTicketCompletion(call.name, args)) {
        // First check: are there outstanding placeholders?
        const placeholderWarning = completionAdvisory(placeholderLedger.outstanding());
        // Second check: is code on the base branch?
        const events = c.trace;
        const isOnBaseBranch = shippedToBaseBranch(events);
        const canComplete = canCompleteTicket(isOnBaseBranch, false); // userDeclinedShipping defaults to false
        if (!canComplete) {
          const said = notOnBaseBranchAdvisory();
          pushTrace(c, { ts: nowIso(), category: 'message', label: 'tools.completion_guard', args: { tool: call.name, isOnBaseBranch }, result: said });
          advisory = said;
        } else if (placeholderWarning) {
          pushTrace(c, { ts: nowIso(), category: 'message', label: 'tools.completion_guard', args: { tool: call.name, open: placeholderLedger.outstanding() }, result: placeholderWarning });
          advisory = placeholderWarning;
        }
      }
      if (isReadTool) {
        // Recording a SUCCESSFUL read is also what arms the exact-repeat stub for it;
        // a failed read is not recorded, so it can be retried.
        const visit = readCoverage.record(call.name, args);
        const target = visit ? visitTarget(args) : undefined;
        advisory = visit && target ? revisitAdvisory(call.name, target, visit) : null;
        if (advisory) {
          pushTrace(c, {
            ts: nowIso(),
            category: 'message',
            label: 'tools.revisit_guard',
            args: { step: iter, tool: call.name, target, visits: visit!.count },
            result: advisory,
          });
        }
      }
    }
    // Trimmed to the transcript budget with the advisory attached AFTER the cut, so
    // the budget can never delete the guard — and a `read_file` is paged by LINE with
    // its continuation offset intact, instead of sliced mid-line with the paging
    // fields (which sit after the content) thrown away. See `toolResultBudget.ts`.
    const trimmedOut = trimToolResult(call.name, out ?? null, { advisory });
    run.pendingRun = { out, toolStart, isReadTool, threw: false, bytes: trimmedOut.bytes, truncated: trimmedOut.truncated };
    return { data: trimmedOut.content, isError: isFailedToolResult(out) };
  };
}
