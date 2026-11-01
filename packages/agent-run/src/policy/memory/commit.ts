/**
 * `@builderforce/agent-run/memory` - the run-end memory commit, as a surface that commits it itself imports it.
 *
 * A surface whose finished run is settled outside `runAgent` (the VS Code editor's `editorRunEnd.ts`) hands the run's note view
 * and code map to {@link commitRunKnowledgeIfAllowed}, with the three things only it has as {@link MemoryCommitDeps}: the model
 * route for the learned-facts completion (whose system prompt is {@link MEMORY_COMMIT_SYSTEM}), the project's fact store, and,
 * when it can read the workspace, the evidence reader (`excerpt`). The code map, the learned-facts extraction and the Memory
 * switch are the agent's, once (`runKnowledgeCommit.ts`, `learnedFacts.ts`).
 *
 * A subpath, not the package root: this is the whole of what that surface imports, so its bundle takes these two modules and
 * not the agent. No `node:*` imports, no DOM.
 */

export {
  MEMORY_OFF_NOTE,
  commitRunKnowledge,
  commitRunKnowledgeIfAllowed,
  type FinishedRun,
  type MemoryCommitDeps,
} from "./runKnowledgeCommit.js";
export { MEMORY_COMMIT_SYSTEM } from "./learnedFacts.js";
