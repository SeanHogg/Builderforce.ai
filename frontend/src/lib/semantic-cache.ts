/**
 * The web app's on-device answer memory — a thin wrapper over the shared store loader.
 *
 * The store itself moved to `@seanhogg/builderforce-brain-embedded`
 * (`loadOnDeviceAnswerStore`): the SSM runtime and `SemanticCache` are host-agnostic, and
 * keeping them here meant Rovr — which runs in Chrome with WebGPU — could not reach a
 * tier it is perfectly able to run. This file remains only so existing web callers keep
 * their import, and so the project scope is applied in exactly one place.
 *
 * PARTITIONED BY PROJECT. The previous builder was memoised under one global key, so a
 * near-identical question asked in project B could replay an answer cached from project
 * A within the same tab. The scope is now part of the loader's key, and each scope gets
 * its own cache instance. A chat with no project yet falls back to a web-only partition
 * that is shared with no project at all.
 */

import { loadOnDeviceAnswerStore, type OnDeviceAnswerStore } from '@seanhogg/builderforce-brain-embedded';

/** The partition used when a web chat has no project yet — shared with no project. */
const UNSCOPED = 'web:unscoped';

/** The Brain's on-device answer memory for one project; null when unavailable. */
export function getOnDeviceAnswerMemory(projectId?: number | null): Promise<OnDeviceAnswerStore | null> {
  return loadOnDeviceAnswerStore(projectId == null ? UNSCOPED : projectId);
}
