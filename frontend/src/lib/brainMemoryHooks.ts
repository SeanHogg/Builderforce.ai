/**
 * The Brain's memory hooks, built once for every web surface that mounts it.
 *
 * The web side panel and the VS Code webview drive the SAME run loop and had drifted:
 * the panel passed `recall` alone while only the webview had the memory-first
 * `answer`/`cacheAnswer` pair, so the same question was free in one surface and billed
 * in the other. The server tier now comes from one shared builder
 * (`projectMemoryHooks`) and this composes the on-device tier in front of it.
 *
 * The creation canvas is deliberately NOT a caller: its runner takes commands, not
 * questions, and replaying a stored answer for "add a node" would return prose where
 * an artifact was asked for. It keeps recall + contribution only.
 *
 * The tiers, nearest first:
 *   1. **On-device** — an SSM-embedded answer memory in this browser. No server in the
 *      path; see `@seanhogg/builderforce-brain-embedded`'s `onDeviceMemory` for why it
 *      replays only near-identical questions and never generates.
 *   2. **The project's server memory** — the exact-repeat Q&A cache, then (tool-less
 *      runs only) the project's Evermind SSM.
 * Recall — grounding the answer in the project's learned corpus — is the server's
 * alone: the local tier has no corpus to ground with.
 */

import {
  composeEvermindHooks,
  onDeviceMemoryHooks,
  projectMemoryHooks,
  type EvermindRunHooks,
} from '@seanhogg/builderforce-brain-embedded';
import { apiRequest } from './apiClient';
import { getOnDeviceAnswerMemory } from './semantic-cache';

/**
 * Memory hooks for a Brain bound to `projectId`, or undefined when the chat is not
 * project-scoped (nothing to recall from, nothing to contribute to).
 *
 * Every leg swallows its own failure and answers "nothing": a memory tier that can fail
 * a turn is worse than no memory tier, and the loop is written to fall through.
 */
export function projectBrainMemoryHooks(projectId: number | null | undefined): EvermindRunHooks | undefined {
  if (projectId == null) return undefined;
  return composeEvermindHooks(
    // The on-device tier is capability-gated inside the loader: no WebGPU, no SSM
    // assets, no worker ⇒ null, and these hooks answer nothing.
    onDeviceMemoryHooks(() => getOnDeviceAnswerMemory()),
    projectMemoryHooks(projectId, apiRequest),
  );
}
