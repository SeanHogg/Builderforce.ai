/**
 * cloudShipGate — the cloud run's publish refusal (PRD 48 §4.2).
 *
 * A cloud run's ship policy is always `pull_request`: it opens its PR and ends, and the PR merge
 * sweep merges by the project's settings. So EVERY raw shell push, pull request or merge through the
 * sandbox's `run_command` (`git push …`, `gh pr create`, `gh pr merge`, a merge through the provider
 * API) is refused BEFORE it dispatches — categorically, not by parsing refspecs, so quoting, nesting
 * and a base branch named anything at all cannot slip through — by THE publish gate every host
 * shares (`publishAllowed(…, 'cloud')`, `@builderforce/run-guards`). The run reads the refusal and
 * carries on; it is never turned into a question.
 *
 * Wraps the guards hook's `beforeDispatch` slot rather than the shell capability, so only the
 * MODEL's calls are judged — the platform's own branch push (finalize, the early draft) is not a
 * tool call and is never refused.
 */
import type { GuardsHook } from '@builderforce/agent-run';
import { publishAllowed, type ShipPolicy } from '@builderforce/run-guards';

/** The guards hook with the ship policy's publish refusal in front of every call. No policy ⇒ unchanged. */
export function withShipGate(
  guards: GuardsHook,
  ship: ShipPolicy | undefined,
  onRefused?: (tool: string, error: string) => Promise<void> | void,
): GuardsHook {
  if (!ship) return guards;
  return {
    ...guards,
    beforeDispatch: async (ctx, call) => {
      const verdict = publishAllowed(ship, call.name, call.args, 'cloud');
      if (!verdict.ok) {
        await onRefused?.(call.name, verdict.error);
        return { skip: { data: { ok: false, error: verdict.error }, isError: true } };
      }
      return guards.beforeDispatch?.(ctx, call);
    },
  };
}
