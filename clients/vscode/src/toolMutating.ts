/**
 * Whether a VS Code tool def asks for approval in ask mode — answered by the ONE shared
 * classifier (`classifyTool` in `@builderforce/agent-tools`), never by a list or a capability
 * guess of this host's. A catalog tool is classified by the catalog; a tool of this host's own
 * says so with `declared.mutates`; anything else is a mutation (fail closed).
 *
 * Only `read` skips the prompt: `verify` (`run_checks`) still runs project scripts, so it asks.
 */

import { classifyTool, type DeclaredToolEffect } from "@builderforce/agent-tools";

export function toolMutating(name: string, declared?: DeclaredToolEffect): boolean {
  return classifyTool(name, declared) !== "read";
}
