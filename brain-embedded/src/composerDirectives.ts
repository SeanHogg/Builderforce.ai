/**
 * composerDirectives — the ONE compiler from the composer's toggles (Effort,
 * Browse-the-web) to the extra system-prompt directives a turn carries.
 *
 * ## Why it lives here
 *
 * There were two copies: `frontend/src/lib/brain/platformPrompt.ts` and a module-private
 * one inside `clients/vscode/webview/src/App.tsx`. They had already drifted three ways,
 * and each drift is a behaviour difference a user can feel:
 *
 *  1. **Effort prose vs. real params.** The web copy hardcoded the two effort sentences;
 *     the VS Code copy derived them from {@link effortProfile}, the same table that sets
 *     `max_tokens` and `reasoning.level`. Hardcoded prose can contradict the params it is
 *     supposed to describe. This version always derives.
 *  2. **A "think step by step" sentence.** The web copy still emitted it even though the
 *     same component sends a structured `reasoning.level` on the wire — two mechanisms for
 *     one intent, the weaker one invisible in the request. Dropped: Thinking is a real
 *     field ({@link reasoningForRun}), not a sentence.
 *  3. **A web-fetch tool name that does not exist.** One copy said `` `fetch_url` ``, the
 *     other `` `web.fetch` ``. The tool is advertised to the model as
 *     {@link WEB_FETCH_TOOL_NAME}. Naming a tool the model was never given is the exact
 *     documented failure that `api/scripts/check-prompt-tool-names.mjs` exists to stop —
 *     the model narrates a call it cannot make and the turn "succeeds". Both copies were
 *     wrong; this one is right, in one place.
 *
 * Pure, host-agnostic, no React: the two surfaces call this and render nothing of their
 * own.
 */

import { type Effort, effortProfile } from './effort';

/**
 * The name the platform's web-fetch tool is ADVERTISED to the model under.
 *
 * The catalog id is `web.fetch`; the gateway advertises every builtin as
 * `builtin_<id with non-alphanumerics → _>` (api `toolNaming.ts` `advertisedName`). A
 * prompt must name the ADVERTISED name — a prompt naming the catalog id hands the model a
 * string that appears nowhere in its tool list, and the model responds by describing the
 * call instead of making it, with no error anywhere in the loop.
 */
export const WEB_FETCH_TOOL_NAME = 'builtin_web_fetch';

/** The composer toggles that compile into prompt directives. */
export interface ComposerDirectiveOptions {
  /** Effort level; `balanced` (or absent) is neutral and contributes nothing. */
  effort?: Effort;
  /** Whether the "Browse the web" toggle is on for this turn. */
  web?: boolean;
}

/**
 * Compile the composer toggles into extra system-prompt directives, folded into the
 * Brain's ambient system context so a toggle actually changes how the next turn runs.
 *
 * Returns `''` when nothing is set — the neutral default, which must add no text at all
 * so a default turn's prompt is byte-identical to one from before the feature existed.
 * Blocks are joined with a blank line so each directive reads as its own instruction.
 */
export function buildComposerDirectives(o: ComposerDirectiveOptions): string {
  const parts: string[] = [];
  const { directive } = effortProfile(o.effort);
  if (directive) parts.push(directive);
  if (o.web) {
    parts.push(
      `You may browse the web: when a question needs current or external information, call the \`${WEB_FETCH_TOOL_NAME}\` tool to read the relevant URL(s) rather than relying on memory, and cite the sources you use.`,
    );
  }
  return parts.join('\n\n');
}
