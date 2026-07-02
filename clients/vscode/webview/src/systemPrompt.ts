import { ideSystemPromptBase, withWorkspaceMap } from '../../src/idePersona';

/**
 * The IDE coding-agent system prompt (persona) for the VS Code Brain webview. The
 * persona text is the SHARED {@link ideSystemPromptBase} (same source the native
 * chat participant uses, in `src/prompt.ts`), so the two surfaces speak as one
 * agent. The codebase grounding map (when the host has scanned the workspace) is
 * appended so the agent locates files without spending tool calls rediscovering
 * structure. The active project is NOT baked in here — it rides the dynamic
 * `extraSystem` ambient channel on `useBrainConversation` (see App.tsx), mirroring
 * the web Brain, so it updates on project switch without rebuilding the persona.
 */
export function buildIdeSystemPrompt(opts: { hasWorkspace: boolean; grounding?: string }): string {
  return withWorkspaceMap(ideSystemPromptBase(opts.hasWorkspace), opts.grounding);
}
