/**
 * The loop's `onNoToolCalls` hook — a turn that ended WITHOUT acting is not accepted as
 * the answer until every gate has had its say: steering that arrived mid-turn, a stall
 * (an announced call never made, work handed back to the user), the workspace stop
 * hook, a code change left unshipped or unreviewed, a sub-agent request never started,
 * a reply that only restated the last one. Then the reply settles — and a model that
 * spent its whole stall budget fails over to another one.
 */

import { liftProseAskUser, replayTextOf, type LoopHooks } from '@builderforce/agent-loop';
import {
  shouldRecoverStalledTurn,
  isExhaustedStall,
  stallShape,
  stallRecoveryNudge,
  stallExhaustedNotice,
  MAX_ANNOUNCEMENT_RECOVERIES,
  stallRecoveryToolChoice,
} from '@builderforce/agent-stall';
import type { ChatCompletionMessage, ContentPart } from '../streamChatCompletion';
import { modelFailoverTrace } from '../runPolicyTraces';
import { takeRunSteering } from './steerInterrupt';
import { persistSteer } from './steerPersistence';
import { askStopHook } from '../stopHooks';
import { leftChangeUnshipped, unshippedChangeNudge } from '../selfReviewShip';
import { leftChangeUnreviewed, unreviewedChangeNudge } from '../previewReview';
import { undelegatedRequestNudge } from '../delegationRequest';
import { runLeftDelegationUndone } from './earlyDelegation';
import { isRestatedReply, restatedReplyNudge } from '../restatedReply';
import { emit, nowIso, pushTrace, runTrace } from './runCells';
import { persistMidTurnText } from './turnPersistence';
import { emitEvermindLearnReconcile } from './runMemory';
import { metaOf, reportToPolicy, settleReply, type RunLoopContext } from './runLoopContext';
import { skipsVerifyStage } from './pipelineRoute';

/** A blocked finish that already wrote files continues on the review model, not the author.
 *  A QUICK run has no verify stage (`pipelineRoute.ts`): it finishes on its coding pass. */
function enterVerifyIfChanged(run: RunLoopContext): void {
  if (!run.c.codeChanged || run.policy.phase === 'verify' || skipsVerifyStage(run.pipeline)) return;
  reportToPolicy(run, { type: 'verify_started' });
}

export function finalAnswerHook(run: RunLoopContext): NonNullable<LoopHooks<ChatCompletionMessage>['onNoToolCalls']> {
  const { c, chatId, runKey, req, convo, canAskUser, catalogToolNames, userRequest, priorReply } = run;
  const { tools: toolSpecs, pickFallbackModel, runTool, persistence, onActivity } = req;
  return async (ctx, turn) => {
    const iter = ctx.step;
    const { result, resolved, requested, advertised, advertisedNames } = metaOf(turn);
    // The model ended the turn without acting — it ANNOUNCED a call it never made
    // ("Calling the tool now." → finish: stop, 0 tool calls), said nothing at all, or
    // HANDED the remaining commands to the user to run. Accepting any of those as a
    // final answer strands the user with a promise, a blank, or homework instead of a
    // result. Nudge and let the loop run another turn — bounded to
    // MAX_ANNOUNCEMENT_RECOVERIES per run so a model that keeps narrating can't spin.
    //
    // `availableToolNames` + `requestText` are what let the HANDOFF shape fire: it is a
    // stall only where this run could have run the commands itself AND the user asked
    // for a change. The request is the one captured before the loop — `latestUserText`
    // here would return the loop's own nudge from the previous iteration.
    const stallInput = {
      text: result.text,
      toolCallCount: result.toolCalls.length,
      availableToolCount: toolSpecs?.length ?? 0,
      recoveriesUsed: run.announcementRecoveries,
      availableToolNames: [...advertisedNames],
      requestText: userRequest,
    };
    const shape = stallShape(stallInput);
    /**
     * Send the turn back with a correction instead of accepting it as the answer.
     * Keeps what the user already watched stream in as its own durable block (the same
     * treatment a narration-before-tool-calls turn gets), then queues the nudge. Shared
     * by every re-prompt below so they cannot drift on what "re-prompted" leaves behind.
     */
    const requeueWithNudge = async (nudge: string | ContentPart[]): Promise<void> => {
      await persistMidTurnText(chatId, c, persistence, result, requested);
      convo.push({ role: 'assistant', content: replayTextOf(result.text) });
      convo.push({ role: 'user', content: nudge });
    };
    // Direction arrived while this turn was being written (an owner redirecting its
    // sub-agent, a child reporting to its owner): the run is not over — what the model
    // said stays as its own block, and the next turn answers the new direction.
    // Multiple queued steers join into one text part; their images ride as vision parts.
    const steering = takeRunSteering(c, runKey, iter);
    if (steering.length > 0) {
      for (const steer of steering) persistSteer(c, chatId, persistence, steer);
      const joinedText = steering.map((m) => m.text).join('\n\n');
      const imageAtts = steering.flatMap((m) => (m.attachments ?? []).filter((a) => a.imageUrl));
      const nudge: string | ContentPart[] = imageAtts.length > 0
        ? [
            { type: 'text', text: joinedText },
            ...imageAtts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } })),
          ]
        : joinedText;
      await requeueWithNudge(nudge);
      c.streamingText = '';
      emit(c);
      return { action: 'continue' };
    }
    if (runTool && shouldRecoverStalledTurn(stallInput)) {
      run.announcementRecoveries += 1;
      const lastChance = run.announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES;
      // One recovery turn: force a structured call so Grok cannot answer the nudge
      // with another prose promise. Cleared after the next complete().
      run.forceToolChoice = stallRecoveryToolChoice(stallInput);
      // `stallInput` rides along as the nudge's context: the PERMISSION-MENU correction
      // only points at `ask_user` when this turn was actually offered it (see
      // `permissionMenu.ts`) — telling a model to call a tool it was never advertised
      // just turns one stall shape into another.
      await requeueWithNudge(stallRecoveryNudge(lastChance, shape, stallInput));
      // Durable: "the loop caught this and re-prompted" is a fact a triage report must
      // still carry after a reload. Live-only, a reopened chat showed nine narrating
      // turns and no sign the loop had ever fought back. The SHAPE rides along, because
      // "re-prompted" alone cannot tell a reader whether the model narrated a call it
      // never made or wrote the user a correct list of commands to go run.
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: shape === 'handed-off' ? 'loop.recover_handed_off_work' : 'loop.recover_announced_tool_call',
        args: { step: iter, attempt: run.announcementRecoveries, of: MAX_ANNOUNCEMENT_RECOVERIES, advertisedTools: advertised, shape },
        result: shape === 'handed-off'
          ? `Model ended by telling the user to run the commands itself holds tools for — re-prompted to run them (${run.announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
          : `Model announced a tool call without making one — re-prompted (${run.announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`,
      });
      c.streamingText = '';
      emit(c);
      return { action: 'continue' };
    }

    // The WORKSPACE's end-of-run directives (`stopHooks.ts`): asked before the ship gate
    // so whatever they make the run do (docs, a changelog line, a lint fix) is part of
    // the change that ships, not a dirty tree left after the push.
    const stopNudge = runTool
      ? await askStopHook(req.onStop, { codeChanged: c.codeChanged, touchedFiles: c.touchedFiles, requestText: userRequest, round: run.stopHookRounds })
      : null;
    if (stopNudge) {
      run.stopHookRounds += 1;
      await requeueWithNudge(stopNudge);
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.stop_hook',
        args: { step: iter, round: run.stopHookRounds },
        result: `A workspace stop hook held the run for another turn: ${stopNudge.slice(0, 200)}`,
      });
      c.streamingText = '';
      emit(c);
      enterVerifyIfChanged(run);
      return { action: 'continue' };
    }

    // The turn CHANGED code and is ending without having even tried to ship it. In a
    // local session that change has no other reviewer: accepted as-is, its delta ticket
    // parks in `in_review` (75%) with nothing that will ever move it. Sent back once
    // with the self-review ship contract. Quiet when the user said not to commit, when
    // a commit/push/PR was attempted (a declined or failed publish is a result to
    // report, not to retry), and on any host that cannot commit and push.
    if (runTool && !run.shipRecoveryUsed && leftChangeUnshipped({
      codeChanged: c.codeChanged,
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c),
    })) {
      run.shipRecoveryUsed = true;
      await requeueWithNudge(unshippedChangeNudge());
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.recover_unshipped_change',
        args: { step: iter, files: c.touchedFiles.slice(0, 20) },
        result: 'Run changed code and ended without committing or pushing it — re-prompted to verify, self-review and ship (this local session is the change\'s only reviewer).',
      });
      c.streamingText = '';
      emit(c);
      enterVerifyIfChanged(run);
      return { action: 'continue' };
    }

    // The Studio's twin of the gate above: the turn CHANGED the app and is ending without
    // having inspected the preview and recorded a review. Nobody else can see that
    // preview, so accepted as-is the change's ticket parks in `in_review` forever. Sent
    // back once; quiet when the user said not to review, and once a review (complete or
    // gaps) follows an inspection — a failed check or a gap is a result to report.
    if (runTool && !run.reviewRecoveryUsed && leftChangeUnreviewed({
      codeChanged: c.codeChanged,
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c),
    })) {
      run.reviewRecoveryUsed = true;
      await requeueWithNudge(unreviewedChangeNudge());
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.recover_unreviewed_change',
        args: { step: iter, files: c.touchedFiles.slice(0, 20) },
        result: 'Run changed the app and ended without inspecting the preview and recording a review — re-prompted to verify and review (this Studio session is the change\'s only reviewer).',
      });
      c.streamingText = '';
      emit(c);
      enterVerifyIfChanged(run);
      return { action: 'continue' };
    }

    // The user asked for SUB-AGENTS and the run is ending in prose without having
    // started one. Sent back once with the delegation contract; quiet once a spawn was
    // attempted (a refused or failed child is a result to report) and on any host that
    // cannot spawn. The `ask_user` twin of this gate is in `beforeToolCalls`.
    if (runTool && !run.delegationRecoveryUsed && runLeftDelegationUndone(run)) {
      run.delegationRecoveryUsed = true;
      await requeueWithNudge(undelegatedRequestNudge(catalogToolNames));
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.recover_undelegated_request',
        args: { step: iter, via: 'reply' },
        result: 'The user asked for sub-agents and the run ended without starting one — re-prompted to spawn them locally.',
      });
      c.streamingText = '';
      emit(c);
      return { action: 'continue' };
    }

    // The reply is the previous turn's status again. The user already has it, so it is
    // sent back once to act on the next unfinished item instead (chat #126: the same
    // "not complete" summary, turn after turn, each rebuilt from a full re-read).
    if (runTool && !run.restateRecoveryUsed && isRestatedReply(result.text, priorReply)) {
      run.restateRecoveryUsed = true;
      await requeueWithNudge(restatedReplyNudge());
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'loop.recover_restated_reply',
        args: { step: iter },
        result: 'Final reply repeated the previous turn\'s answer — re-prompted to act on the next unfinished item instead of restating it.',
      });
      c.streamingText = '';
      emit(c);
      return { action: 'continue' };
    }

    // Final text — record in the transcript, persist, broadcast to mounted views. A
    // model that asked its question in prose instead of calling `ask_user` still
    // gets the clickable card (see liftProseAskUser).
    const settledText = result.text.trim();
    const finalText = (canAskUser ? liftProseAskUser(settledText) : settledText) || 'No response.';
    const assistantMsg = await settleReply(run, finalText, result, requested);

    // This model spent its whole recovery budget still DESCRIBING calls instead of
    // making them — or still handing them to the user. Re-prompting it again is spent — the only remedy that works is a
    // different model, so the run switches to one itself rather than handing the user
    // a promise and telling them to go pick one (the "it doesn't execute, it just
    // dies" report). Bounded by MAX_MODEL_FAILOVERS: a run that has burned two models
    // stops and says so rather than walking the catalog on the tenant's money.
    if (runTool && isExhaustedStall(stallInput)) {
      // The SHARED decision — record both the asked-for and the resolved model (a
      // gateway auto-select run pinned nothing, so `resolved` is the only id that
      // identifies the model to skip), check the budget, pick a different route. The
      // server-side addressed-reply loop calls the same function.
      const { outcome } = reportToPolicy(run, { type: 'stalled', resolvedModel: resolved, pick: pickFallbackModel });
      if (outcome.kind === 'failed_over') {
        pushTrace(c, modelFailoverTrace(nowIso(), iter, resolved, outcome, shape));
        // The new model starts with a full stall budget — the old one's failures say
        // nothing about this one, and carrying the count over would give it no chance.
        run.announcementRecoveries = 0;
        run.forceToolChoice = stallRecoveryToolChoice(stallInput);
        convo.push({ role: 'user', content: stallRecoveryNudge(false, shape, stallInput) });
        c.streamingText = '';
        emit(c);
        return { action: 'continue' };
      }
      const notice = stallExhaustedNotice(resolved, run.policy.tried, shape);
      pushTrace(c, {
        ts: nowIso(),
        category: 'error',
        label: 'loop.stall_unrecovered',
        args: { step: iter, model: resolved, attempts: run.announcementRecoveries, tried: run.policy.tried, advertisedTools: advertised, shape },
        result: notice,
        isError: true,
      });
      c.error = notice;
    }
    emit(c);

    emitEvermindLearnReconcile(run, assistantMsg, finalText);

    onActivity?.(chatId);
    return { action: 'stop', ok: true, output: finalText };
  };
}
