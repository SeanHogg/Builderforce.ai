/**
 * How the on-prem stall failover IDENTIFIES a model.
 *
 * The stall recovery itself (a turn that ended without calling a tool, the re-prompt budget, the failover onto the operator's
 * declared chain, the explained stop) is the one agent's (`@builderforce/agent-run` `policy/stall`, over the shared
 * `@builderforce/run-policy` step). What is on-prem-specific is the MODEL: here a `Model` is a resolved object on the
 * operator's own hardware, not a gateway id, so the agent tracks models by this ref and the channel's model port maps the ref
 * the agent chose back to the `Model` the host's picker resolved.
 */

/** How the stall failover IDENTIFIES a model. On-prem the same model id is served by
 *  several providers (`ollama/qwen3` and `openrouter/qwen3` are different routes with
 *  different failure modes), so the id alone cannot say what has already been tried —
 *  the ref is the pair. One owner, because a picker has to compare against the same
 *  strings the agent puts in `tried`. */
export function modelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}
