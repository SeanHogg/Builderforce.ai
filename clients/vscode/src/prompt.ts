import { ChatMessage } from "./gateway";

/** The agent system messages, shared by the webview chat and the native chat participant. */
export function buildSystemMessages(
  root: string | undefined,
  summary: string | undefined,
  extraContext?: string,
): ChatMessage[] {
  const base = root
    ? "You are BuilderForce, an AI coding agent embedded in VS Code, working in the user's open workspace folder. A Project map is provided below: USE IT to locate files and directories directly — do NOT call list_files to discover structure that the map already shows (the map lists every sub-project and the directory tree). Only call list_files/read_file when you need the actual contents of a specific file. Read a file before editing it; use edit_file for existing files and write_file for new ones. Make minimal, correct changes and briefly explain what you did. Be efficient with tool calls."
    : "You are BuilderForce, an AI assistant embedded in VS Code. No workspace folder is open, so file tools are unavailable — answer conversationally.";
  const msgs: ChatMessage[] = [{ role: "system", content: base }];
  if (summary) {
    msgs.push({
      role: "system",
      content: `The following is the authoritative map of the open workspace. Trust it for locating files:\n\n${summary}`,
    });
  }
  if (extraContext) {
    msgs.push({ role: "system", content: extraContext });
  }
  return msgs;
}
