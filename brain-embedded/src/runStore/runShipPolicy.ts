/**
 * The run's SHIP POLICY (PRD 48), resolved once by the preamble beside the chat's publish
 * hold. A sub-agent — a run with an owner (`lineage`, the same input `toolScope: 'subagent'`
 * reads in `run/webAdapter.ts`) — ships nothing: its owner verifies the fan-out and ships
 * once. Any other run takes the host's policy (the run's project's ship policy, a project
 * setting read from the API), or the default when the host sent none. A chat's publish hold then narrows either to uncommitted.
 */

import { DEFAULT_SHIP_POLICY, narrowByHold, shipPolicyOf, type ShipHold, type ShipPolicy } from '@builderforce/run-guards';
import type { BrainRunRequest } from './runTypes';

export function runShipPolicy(req: Pick<BrainRunRequest, 'lineage' | 'shipPolicy'>, hold: ShipHold | null): ShipPolicy {
  const base = req.lineage ? shipPolicyOf('leave_uncommitted', 'subagent') : (req.shipPolicy ?? DEFAULT_SHIP_POLICY);
  return narrowByHold(base, hold);
}
