/**
 * Memory hooks for the interactive VSIX chat.
 *
 * The chat runs in the Chromium webview, so the on-device tier is the same loader the
 * web and Rovr use: null without WebGPU, partitioned by project, and asked before the
 * server. The extension-host run does not call this — Node has no WebGPU, and a loader
 * there would always be null (see `projectEvermindHooks`).
 */
import {
  composeEvermindHooks,
  loadOnDeviceAnswerStore,
  onDeviceMemoryHooks,
  projectMemoryHooks,
  type EvermindRunHooks,
  type ProjectMemoryRequest,
} from '@seanhogg/builderforce-brain-embedded';

export function vsixWebviewMemoryHooks(
  projectId: number,
  request: ProjectMemoryRequest,
  chatId: number | null,
): EvermindRunHooks | undefined {
  return composeEvermindHooks(
    onDeviceMemoryHooks(() => loadOnDeviceAnswerStore(projectId)),
    projectMemoryHooks(projectId, request, chatId, 'vsix'),
  );
}
