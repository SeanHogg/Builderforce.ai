import { ChatMessage } from "./gateway";
import { ideSystemPromptBase, WORKSPACE_MAP_INTRO } from "./idePersona";

/** The agent system messages, shared by the native chat participant + session tab.
 *  The persona text itself lives in {@link ideSystemPromptBase} so it can't drift
 *  from the Brain webview's prompt. */
export function buildSystemMessages(
  root: string | undefined,
  summary: string | undefined,
  extraContext?: string,
  limbicBlock?: string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: ideSystemPromptBase(!!root) }];
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
