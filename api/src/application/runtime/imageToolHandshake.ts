/**
 * What an IMAGE surface may actually be offered — the reconciliation between what a
 * capability set permits and what the process on the other end can dispatch.
 *
 * The two image surfaces (the Cloudflare Container and the GitHub Actions runner) run
 * their own tool loop in a separately shipped artifact. That used to impose an ordering
 * rule on every new tool: the capability had to follow the DEPLOYED image, because
 * advertising a tool an older image had no handler for produced `unknown tool` mid-run
 * — a wasted step and a model told it could do something it then could not. The rule
 * was real, but it was enforced by memory and by comments, and it is why `orchestrate`
 * and `skill.author` sat outside `CONTAINER_SURFACE_CAPS` long after their Worker-side
 * backing existed.
 *
 * The handshake replaces the rule with a mechanism. Every image sends the tool names it
 * can dispatch (`SUPPORTED_TOOL_NAMES` from the shared relay module) on each `llm` op,
 * and the Worker offers the INTERSECTION. A capability can then be added the moment its
 * op exists: a current image names the tool and gets it; an image that predates it does
 * not name it and is never offered it. Nothing has to be deployed in a particular order
 * ever again.
 *
 * This module is pure and knows nothing about runs, tenants or the gateway — it is the
 * one rule, so it is tested directly rather than only through a container run.
 */

import type { ToolSchema } from '@builderforce/agent-tools';

/**
 * Tool names withheld from an image that sends NO manifest.
 *
 * An image predating the handshake cannot tell us what it implements, so the safe read
 * of its silence is "whatever the images already deployed when the handshake shipped".
 * Every tool added to a surface's capability set FROM NOW ON goes in here, and comes out
 * only if the entry is ever retired — which it need not be, because a current image
 * always sends a manifest and is never filtered by this list.
 *
 * `spawn_agent` is the first entry: `orchestrate` became a container capability in the
 * same pass that introduced the handshake, so an un-redeployed image must not see it.
 */
export const HANDSHAKE_ONLY_TOOLS: readonly string[] = ['spawn_agent'];

/**
 * Whether `name` is covered by a manifest entry. A trailing `*` is a PREFIX match, which
 * is how an image declares support for a whole relayed family (`builtin_*`) without
 * needing a redeploy each time the Worker adds one to the platform catalog.
 */
function declares(manifest: readonly string[], name: string): boolean {
  return manifest.some((entry) => (entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : entry === name));
}

/**
 * Read an image's declared manifest off a container-op payload. Anything that is not a
 * non-empty array of strings is treated as ABSENT (not as an empty manifest): an image
 * that sends nothing must fall back to the pre-handshake set, not lose every tool.
 */
export function readToolManifest(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return names.length > 0 ? names : null;
}

/**
 * The schemas to advertise to an image, given what it says it can dispatch.
 *
 * With a manifest: exactly the intersection — the image is the authority on its own
 * dispatch table, and offering it anything else is offering a tool certain to fail.
 * Without one: everything except {@link HANDSHAKE_ONLY_TOOLS}, which is the toolset
 * every image deployed before the handshake is known to implement.
 */
export function imageAdvertisedTools(
  tools: readonly ToolSchema[],
  manifest: readonly string[] | null,
): ToolSchema[] {
  if (!manifest) return tools.filter((tool) => !HANDSHAKE_ONLY_TOOLS.includes(tool.function.name));
  return tools.filter((tool) => declares(manifest, tool.function.name));
}
