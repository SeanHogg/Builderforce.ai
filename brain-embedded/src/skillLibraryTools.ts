/**
 * The Agent Skills tool the platform catalog advertises, and why the Brain always keeps it.
 *
 * `builtin_skills_read` loads one of the workspace's skills — a reviewed procedure — and
 * the gateway writes the workspace's skill catalog into its description, so it is how the
 * Brain on the web, in VS Code and in Rovr learns which skills exist. The per-turn tool
 * selector trims the catalog by LEXICAL relevance, and a request like "ship the
 * migration" shares no stem with "skills_read": left to relevance, the one tool that
 * would hand the agent the workspace's own procedure is the first one dropped. So it is
 * pinned whenever the catalog offers it — and a workspace with no skills is not offered
 * it, so the pin costs nothing there.
 *
 * Framework-free, like `localWorkspaceTools`, so it is safe in every bundle.
 */

import { SKILL_READ_TOOL_NAME } from '@builderforce/agent-skills';

/** The skill tools this run actually has, out of a catalog — always advertised. */
export function skillToolsIn(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => name === SKILL_READ_TOOL_NAME);
}
