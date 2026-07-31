import { ChatMessage } from "./gateway";
import { ideSystemPromptBase, activeProjectDirective, WORKSPACE_MAP_INTRO, type ActiveProject } from "./idePersona";
import { getSelectedProject } from "./projectState";

/** The agent system messages, shared by the native chat participant + session tab.
 *  The persona text itself lives in {@link ideSystemPromptBase} so it can't drift
 *  from the Brain webview's prompt. The active project is injected as ambient
 *  context from the SAME selected-project state the Brain webview uses, so both
 *  surfaces are project-aware. */
export function buildSystemMessages(
  root: string | undefined,
  summary: string | undefined,
  extraContext?: string,
  limbicBlock?: string,
  project: ActiveProject | undefined = getSelectedProject(),
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: ideSystemPromptBase(!!root) }];
  const projectDirective = activeProjectDirective(project);
  if (projectDirective) {
    msgs.push({ role: "system", content: projectDirective });
  }
  if (summary) {
    msgs.push({ role: "system", content: `${WORKSPACE_MAP_INTRO}\n\n${summary}` });
  }
  if (extraContext) {
    msgs.push({ role: "system", content: extraContext });
  }
  if (limbicBlock) {
    msgs.push({ role: "system", content: limbicBlock });
  }
  return msgs;
}
