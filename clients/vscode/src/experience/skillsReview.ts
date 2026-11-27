import { elementLabel, needsApproval, slug, type Episode } from "@seanhogg/builderforce-memory-engine";
import type { ReviewView } from "./skillsViewProtocol";

/** The review's view of a stored episode: each recorded step with its default approval gate and suggested parameter name. */
export function buildReview(episode: Episode): ReviewView {
  return {
    episodeId: episode.id,
    name: episode.name,
    program: episode.program,
    steps: episode.steps.map((st) => {
      const a = st.action;
      const isValue = a.kind === "setValue";
      const label = a.kind === "keys" ? "" : elementLabel(a.target);
      return {
        id: st.id,
        kind: a.kind,
        target: a.kind === "keys" ? a.keys : label,
        isValue,
        secret: a.kind === "setValue" && !!a.secret,
        paramName: isValue ? slug(label) || "value" : "",
        requiresApproval: needsApproval(a),
      };
    }),
  };
}

/** The name a recording gets when the helper left it blank: the program's file name. */
export function defaultEpisodeName(program: string): string {
  const base = program.split(/[\\/]/).pop() ?? program;
  return base.replace(/\.[^.]+$/, "") || base || program;
}
