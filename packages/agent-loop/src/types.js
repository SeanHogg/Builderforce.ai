/**
 * Contract of THE agent loop.
 *
 * One iteration = ask the model → run every tool it called → ask again, until the
 * model stops calling tools, a tool signals `finish`, a tool asks a human, the run is
 * cancelled or the step budget is spent. The kernel owns exactly that skeleton — the
 * budget, the cancel check, argument parsing, pushing the assistant / tool messages
 * and interpreting the two control signals. Everything a surface does differently
 * (steering, compaction, policy gates, stall recovery, tool selection, telemetry,
 * confirm prompts, read de-duplication) arrives through the ports and hooks below,
 * so the SAME kernel drives the Worker, the browser, Node and the extension host.
 *
 * `M` is the surface's own message type (OpenAI chat rows in most places, pi-style
 * `AgentMessage` in agent-runtime). The kernel never inspects a message — it only
 * asks the codec to build them and pushes them onto the transcript it was handed.
 */
/**
 * Consecutive failed tool dispatches after which a run is stopped, when the surface
 * names no other number. ONE value, owned here, so every surface stops for the same
 * reason at the same point.
 *
 * ── WHY A FAILURE STREAK, AND NOT A STEP COUNT ──────────────────────────────────
 * A run is not wrong for being long. A bulk ticket clean-up, a rename across a
 * repository, a review of forty branches — each is a hundred honest tool calls, and a
 * step ceiling stopped every one of them mid-task with "kept calling tools without
 * finishing". The ceiling existed to catch a run that had stopped making progress, and
 * that condition has a direct signal: tool calls that keep FAILING. So the only limit
 * the kernel applies is this one — a run whose last N dispatches all failed is stuck,
 * and stopping it is what the step cap was always trying to do by proxy. Five is past
 * the point where the repeat-failure advisories (nudge at 2, instruct at 3) have had
 * their say and been ignored.
 */
export const DEFAULT_TOOL_FAILURE_STREAK = 5;
//# sourceMappingURL=types.js.map