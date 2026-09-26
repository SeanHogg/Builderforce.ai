/**
 * Memory that names code the workspace no longer has is flagged, not obeyed.
 *
 * A recalled fact or Evermind memory saying "use `resolveMembership`" after that function
 * was deleted is the most damaging kind of memory: confident, specific and wrong. With
 * Builderforce Desktop running, every recalled text is checked against the live index
 * and any path or symbol it names that no longer exists is attached to it as a
 * "possibly stale" note, so the agent verifies before acting on it.
 *
 * Both recall paths go through here — the `recall_facts` tool and the Evermind recall
 * block the run loop injects — so the check is one rule, applied everywhere. Without the
 * desktop service nothing changes: memories pass through untouched.
 */

import type { EvermindRecallResult, EvermindRunHooks } from "@seanhogg/builderforce-brain-embedded";
import { checkReferences, type MissingReference } from "./desktopContext";

/** Model-facing annotation for a memory whose references are gone. */
export function staleNote(missing: readonly MissingReference[]): string {
  const names = missing.map((m) => `\`${m.reference}\``).join(", ");
  return `POSSIBLY STALE: names ${names}, which no longer exist in this workspace — verify against the current code before relying on it.`;
}

/** Per text, the missing references (empty = nothing stale / nothing checkable). */
export async function staleReferences(root: string | undefined, texts: readonly string[]): Promise<MissingReference[][]> {
  if (!root || texts.length === 0) return texts.map(() => []);
  return (await checkReferences(root, texts)) ?? texts.map(() => []);
}

/**
 * Evermind hooks whose recalled memories carry the staleness note. The other hooks pass
 * through unchanged. `root` undefined (no folder open) ⇒ the hooks are returned as-is.
 */
export function withWorkspaceStaleness<H extends EvermindRunHooks | undefined>(hooks: H, root: string | undefined): H {
  if (!hooks || !root) return hooks;
  const wrapped: EvermindRunHooks = {
    ...hooks,
    async recall(query: string): Promise<EvermindRecallResult | null> {
      const result = await hooks.recall(query);
      if (!result || result.items.length === 0) return result;
      const missing = await staleReferences(root, result.items.map((i) => i.text));
      return {
        ...result,
        items: result.items.map((item, i) => (missing[i]?.length ? { ...item, text: `${item.text}\n${staleNote(missing[i]!)}` } : item)),
      };
    },
  };
  return wrapped as H;
}
