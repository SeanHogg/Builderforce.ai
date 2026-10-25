/**
 * One Hybrid Auto turn's use of the `run.local-success` predictor: consult it once the
 * local-first plan is known (before any attempt), and settle the turn's outcome into it
 * as a label — whichever way the turn went.
 *
 * Every outcome is recorded, in the engine's vocabulary (`LocalSuccessOutcome`), and the
 * engine's `localSuccessLabel` decides what each one teaches:
 *  - the local model served                → local `succeeded`;
 *  - the local attempt failed, the cloud answered (or failed) → local `failed`, `fellBack`;
 *  - the predictor skipped local           → the cloud's own result only (a cloud success
 *    says nothing about local; a cloud failure is weak evidence the turn was hard).
 *
 * Not recorded: a turn the person stopped (it says nothing about either model), and a
 * cloud refusal the person can act on (a 4xx: sign-in, plan, key) — that is about the
 * account, not about how hard the turn was. *
 * E5 (lever `e5_verified_local_label`): a SERVED local turn in a chat is not recorded at
 * settle time — "served" is only the transport's word. Its record is deferred until the
 * chat's next call (or an explicit rating) gives a verdict, or a timeout falls back to the
 * transport label (`verifiedLocalLabel.ts`).
 */

import { runsOnDevice, type LocalFirstAttempt, type LocalFirstAttemptRecord, type LocalRuntimeProbe } from '@builderforce/local-inference';
import type { LocalSuccessOutcome, TurnResult } from '@seanhogg/builderforce-memory-engine';
import { BrainRequestError } from '../chatError';
import type { StreamChatOptions } from '../streamChatCompletion';
import { contextWindowOf } from '../windowFit/modelWindow';
import type { LocalSuccessRouter } from './localSuccessRouter';
import { localTurnFeatures } from './turnFeatures';
import {
  conversationKeyOf,
  deferredLocalRecords,
  submitPrompt,
  verifiedLocalLabelOn,
  type DeferredLocalRecords,
} from './verifiedLocalLabel';

type CallOpts = Omit<StreamChatOptions, 'transport'>;

/** What `createLocalFirstStream` is lent for one call, and how the call is settled. */
export interface HybridLocalSuccessTurn {
  /** Consulted once with the plan, before any attempt: drops its local attempts on a confident "fails". */
  gate(plan: LocalFirstAttempt[], call: CallOpts): Promise<LocalFirstAttempt[]>;
  /** Each settled attempt of the call. */
  onAttempt(record: LocalFirstAttemptRecord): void;
  /** The call finished (`error` when it threw). Records the outcome; never throws. */
  settle(error?: unknown): void;
}

/** An attempt on THIS DEVICE — what the predictor assesses (not a connected account, not the cloud). */
function onDevice(attempt: LocalFirstAttempt): attempt is Extract<LocalFirstAttempt, { kind: 'local' }> {
  return attempt.kind === 'local' && runsOnDevice(attempt.ref);
}

function cloudResult(records: readonly LocalFirstAttemptRecord[], error: unknown): TurnResult | undefined {
  const cloud = records.find((r) => r.attempt.kind === 'cloud');
  if (!cloud) return undefined;
  if (cloud.outcome === 'served') return 'succeeded';
  if (error instanceof BrainRequestError && error.status >= 400 && error.status < 500) return undefined;
  return 'failed';
}

export function hybridLocalSuccessTurn(
  router: LocalSuccessRouter,
  probes: readonly LocalRuntimeProbe[],
  signal?: AbortSignal,
  deferred: DeferredLocalRecords = deferredLocalRecords,
): HybridLocalSuccessTurn {
  let assessed: { ref: string; outcome: Pick<LocalSuccessOutcome, 'turn'> } | null = null;
  /** The chat + submit this call belongs to — the key a served local answer waits under for its verdict. */
  let submit: { conversation: string; prompt: string } | null = null;
  const records: LocalFirstAttemptRecord[] = [];
  return {
    async gate(plan, call) {
      const conversation = conversationKeyOf(call);
      if (conversation && verifiedLocalLabelOn()) {
        // This call is the verdict on the chat's previous local answer (retry, tool
        // refusal, or moving on) — read it before this turn is assessed.
        deferred.observe(conversation, call);
        submit = { conversation, prompt: submitPrompt(call) };
      }
      // The predictor is about THIS DEVICE: a connected account (Kimi) is never skipped by it.
      const local = plan.find(onDevice);
      // Only a plan with somewhere to go instead is worth gating.
      if (!local || !plan.some((a) => !onDevice(a))) return plan;
      try {
        const verdict = await router.assess(local.ref, localTurnFeatures(call, contextWindowOf(local.ref, { probes })));
        assessed = { ref: local.ref, outcome: { turn: verdict.turn } };
        return verdict.skip ? plan.filter((a) => !onDevice(a)) : plan;
      } catch {
        return plan; // the predictor never blocks a turn
      }
    },
    onAttempt(record) {
      records.push(record);
    },
    settle(error) {
      if (!assessed || signal?.aborted) return;
      const local = records.find((r) => r.attempt.kind === 'local' && r.attempt.ref === assessed!.ref);
      const cloud = cloudResult(records, error);
      const outcome: LocalSuccessOutcome = {
        ...assessed.outcome,
        ...(local ? { local: local.outcome === 'served' ? 'succeeded' : 'failed' } : {}),
        ...(local && local.outcome !== 'served' && records.some((r) => r.attempt.kind === 'cloud') ? { fellBack: true } : {}),
        ...(cloud ? { cloud } : {}),
      };
      if (submit && local?.outcome === 'served' && verifiedLocalLabelOn()) {
        deferred.defer({ ...submit, ref: assessed.ref, outcome, record: (ref, o) => router.record(ref, o) });
        return;
      }
      // `record` never rejects — it reports its own failure (`localSuccessFailure.ts`).
      void router.record(assessed.ref, outcome);
    },
  };
}
