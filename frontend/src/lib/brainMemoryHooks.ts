/**
 * The Brain's memory hooks, built once for every web surface that mounts it.
 *
 * Both web Brains — the side panel and the canvas — used to hand-build this object,
 * and they had drifted: the panel passed `recall` alone, the canvas passed `recall`
 * plus a `learn` callback the run loop has no field for (so it was never called), and
 * NEITHER passed the memory-first `answer`/`cacheAnswer` pair that the VS Code Brain
 * has had all along. Same loop, three different memories. One factory, so a tier added
 * here reaches every surface.
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
