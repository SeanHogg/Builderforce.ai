import type { CliBackendConfig } from "../../config/types.js";

/** A CLI backend's argv as the debug log shows it: the system prompt, the prompt and the images are sizes, not contents. */
export function formatCliArgvForLog(backend: CliBackendConfig, args: readonly string[], argsPrompt: string | undefined): string {
  const logArgs: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === backend.systemPromptArg) {
      logArgs.push(arg, `<systemPrompt:${(args[i + 1] ?? "").length} chars>`);
      i += 1;
      continue;
    }
    if (arg === backend.sessionArg || arg === backend.modelArg) {
      logArgs.push(arg, args[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === backend.imageArg) {
      logArgs.push(arg, "<image>");
      i += 1;
      continue;
    }
    logArgs.push(arg);
  }
  if (argsPrompt) {
    const promptIndex = logArgs.indexOf(argsPrompt);
    if (promptIndex >= 0) {
      logArgs[promptIndex] = `<prompt:${argsPrompt.length} chars>`;
    }
  }
  return logArgs.join(" ");
}
