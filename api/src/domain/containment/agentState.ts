/** A named agent may execute only while explicitly active. Unknown is reserved for
 * the gateway-default compatibility bucket and is not a persisted agent state. */
export function isAgentRunnable(status: string): boolean {
  return status === 'active';
}
