/**
 * Can this ticket mutation change what the lane trigger decides?
 *
 * The lane trigger ({@link ./laneEntryTrigger}) is a multi-query evaluation: the
 * board, the lane and its staffing, the ticket's executions, the requirement gate,
 * the token gate. Writers used to decide on their own when to call it (one compared
 * statuses, one compared owners, the MCP path did both and evaluated twice when a
 * single update changed both), and a mutation that touched none of its inputs still
 * paid for the whole evaluation. This is the ONE rule, read off what
 * `evaluateTaskAutoRun` actually reads from the task row:
 *
 *  • `status`      — the lane, hence the gate, the staffing and the loop guard;
 *  • `projectId`   — the board the lane is resolved on;
 *  • `assignedAgentRef` — the owner fallback candidate. Only a NEW non-null owner can
 *    add a candidate; clearing the owner can only remove one, so it never starts work;
 *  • `taskType` / `actionType` — a managed stage's requirement applicability.
 *
 * Lane-side inputs (staffing, gate, cooldown, a run finishing) are not ticket
 * mutations; their own writers re-route the lane's residents (laneResidentBackfill)
 * or are swept by the autonomous backstop.
 */
export interface LaneEntryInputs {
  projectId?: number | null;
  status?: string | null;
  assignedAgentRef?: string | null;
  taskType?: string | null;
  actionType?: string | null;
}

/**
 * True when the mutation from `before` to `after` can change the lane trigger's
 * outcome. `before` null/undefined is a create: the ticket entered its first lane.
 * A field left undefined in `after` was not part of the write and is not compared.
 */
export function mutationCanTriggerLaneEntry(
  before: LaneEntryInputs | null | undefined,
  after: LaneEntryInputs,
): boolean {
  if (!before) return true;
  const changed = (key: 'status' | 'projectId' | 'taskType' | 'actionType'): boolean =>
    after[key] !== undefined && (after[key] ?? null) !== (before[key] ?? null);
  if (changed('status') || changed('projectId') || changed('taskType') || changed('actionType')) return true;
  const owner = after.assignedAgentRef ?? null;
  return owner !== null && owner !== (before.assignedAgentRef ?? null);
}
