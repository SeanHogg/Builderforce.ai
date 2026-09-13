/**
 * The analysis→code hand-off, as it appears on the wire.
 *
 * When an auto-routed run's planning turn reaches for its first code change, the loop
 * discards that turn and re-asks the SAME turn, from the same transcript, with role
 * `code` (see `brainRunStore.ts`). A request with role `code` straight after one with
 * role `plan` is that re-ask — a run's role only ever moves from plan to code there.
 *
 * Exported so a scripted gateway can recognise the re-ask and replay the current step
 * instead of advancing its script: a real coding model, handed the same transcript,
 * makes the same move. Pure.
 */
export function isCoderReask(role: string | undefined, previousRole: string | undefined): boolean {
  return role === 'code' && previousRole === 'plan';
}
