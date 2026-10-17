/**
 * The run-store key a canvas session's Brain turns run under (`startEngineRun`). One
 * key per session: the board dock, the Chat lens and the inline Brain Object all
 * observe — and Stop, and approve — the same run, which outlives whichever of them
 * started it.
 */
export function canvasRunKey(sessionId: string): string {
  return `canvas:${sessionId}`;
}
