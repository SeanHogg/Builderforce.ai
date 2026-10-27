/**
 * The editor's local model for `local_research`, registered at activation.
 *
 * Not a second local client, and not a second router: the transport is chosen in the ONE
 * routing seam (`modelRouting.ts` → `completeOnDevice`), which runs the SAME on-device
 * path a local-first turn takes — Synapse native in the editor's host worker and the
 * page engines, HTTP runtimes such as Ollama ranked by the shared plan — with NO cloud
 * fallback, so a research answer is free tokens or nothing.
 */

import { completeOnDevice, onDeviceModelAvailable } from "../modelRouting";
import type { LocalResearchPort } from "./researchPort";

export function editorResearchPort(): LocalResearchPort {
  return {
    available: () => onDeviceModelAvailable(),
    complete: (messages, signal) => completeOnDevice(messages, signal),
  };
}
