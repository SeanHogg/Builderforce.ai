/**
 * DELEGATION REQUEST — the user asked for sub-agents, so the run starts them.
 *
 * The rule (an explicit sub-agent request, a host that can spawn, and no spawn attempted
 * in this run) and what the run is told instead of settling — the end-of-run nudge and the
 * early one — live ONCE, in `@builderforce/agent-run` (`policy/subagents`), so the Brain,
 * the cloud and the on-prem agent apply the same gate. This module is the Brain's import
 * path for it; it holds no copy.
 */

export {
  asksForSubagents,
  attemptedDelegation,
  canSpawnHere,
  earlyDelegationNudge,
  isSpawnTool,
  leftDelegationUndone,
  undelegatedRequestNudge,
  type DelegationRequestInput,
} from '@builderforce/agent-run';
