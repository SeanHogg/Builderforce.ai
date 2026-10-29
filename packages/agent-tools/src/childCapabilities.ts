/**
 * What a sub-agent HOLDS: a CLONE of its owner — the owner's capabilities, minus only what
 * a child mechanically cannot do. One rule for every surface (the cloud's durable children,
 * the on-prem children, the editor's), so it lives with the capability catalog. Pure.
 *
 *   • A child never gets `human`. A run pauses for a person by ending the whole execution
 *     and waiting for an answer on resume; a child that could trigger that would strand its
 *     owner mid-task with no way back.
 *   • A child spawns its own children only while it is above the depth cap — the same
 *     recursion rule the editor's children follow (`MAX_SUBAGENT_DEPTH`).
 */

import type { Capability } from "./capabilities.js";

/** The delegation capabilities — granted to a child only while it may still spawn. */
export const DELEGATION_CAPABILITIES: readonly Capability[] = ["orchestrate", "orchestrate.fanout", "orchestrate.live"];

/**
 * Never handed to a child, whatever its owner holds.
 *
 * `skill.author` is withheld for the reason the tool exists at all: a skill is a
 * procedure every FUTURE run is told to follow, and the run accountable for proposing
 * one is the run a person can ask about it — not a child its owner commissioned and
 * summarised in a sentence.
 */
export const NON_DELEGABLE_CAPABILITIES: readonly Capability[] = ["human", "skill.author"];

/** The child's capability set: its owner's, minus what is never delegable, minus
 *  delegation itself at the depth cap. */
export function childCapabilities(parent: ReadonlySet<Capability>, canSpawn = false): ReadonlySet<Capability> {
  const withheld = new Set<Capability>([...NON_DELEGABLE_CAPABILITIES, ...(canSpawn ? [] : DELEGATION_CAPABILITIES)]);
  return new Set([...parent].filter((c) => !withheld.has(c)));
}
