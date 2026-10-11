/**
 * The standing instructions of a SUB-AGENT — the one thing about a child that is not
 * the ordinary run it is.
 *
 * A child runs through the same loop as any run, on every surface: the editor starts it
 * as a run with an owner pointer (`runLineage.ts`), the cloud as a durable execution with
 * one (`cloudChildRuns.ts`). It works beside its owner, hears direction from it, and its
 * final message is its report. What it is TOLD about that relationship is decided once,
 * here, or the two surfaces would delegate to subtly different children.
 *
 * Zero dependencies, like the rest of this package.
 */

/**
 * WHO the child is acting AS, when the owner delegated to one of the workspace's own
 * agents rather than to an anonymous helper.
 *
 * `brief` is the agent's compiled persona prompt — its role, bio, skills and personality,
 * built by whichever surface owns that compilation. This package never builds one; it
 * only decides WHERE the brief goes.
 */
export interface SubagentPersona {
  name: string;
  brief: string;
}

/** The agent a child reports to. */
export interface SubagentLiveOwner {
  /** Display name of the owner, as the chat shows it. */
  owner: string;
}

/**
 * The child's standing instructions.
 *
 * A PERSONA goes FIRST, above the sub-agent rules. The order is the point: identity
 * frames the work ("you are Ada, the workspace's data engineer — and here is how a
 * sub-agent behaves"), whereas appending it would read as an afterthought the model
 * discards once the rules have set the tone. The sub-agent rules still follow and still
 * win on procedure: a persona changes the VOICE and the EXPERTISE, never the read-only
 * boundary or the requirement to finish with a standalone report.
 */
export function subagentSystemPrompt(readOnly: boolean, persona: SubagentPersona | undefined, live: SubagentLiveOwner): string {
  const identity = persona
    ? [
      `You are acting as ${persona.name}, one of this workspace's agents. Stay in that agent's role and voice.`,
      persona.brief,
    ]
    : [];
  return [
    ...identity,
    `You are a sub-agent spawned by ${live.owner}, which owns this work and keeps working while you do your slice.`,
    `It sees only what you post, and your FINAL message is your report to it — so that message must stand alone: what you did, what you found, and anything left undone.`,
    `${live.owner} (or the person it works for) may redirect you mid-task: a message beginning "[${live.owner}]" is direction from your owner — follow it over your original brief.`,
    readOnly
      ? "You are READ-ONLY: investigate, read and search, but do not attempt to change anything."
      : "You may make the change you were asked to make, and nothing beyond it.",
    "Answer with concrete findings: exact file paths, names and line references, and an explicit \"not found\" where that is the honest result.",
    "Never end with a promise to continue; finish the slice, then report.",
  ].join("\n");
}
