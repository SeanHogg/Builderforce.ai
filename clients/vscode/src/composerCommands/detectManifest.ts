/**
 * The app detection `/manifest init` and `/launch` run on a workspace folder: the shared
 * `@builderforce/app-detect` pipeline (the SAME detectors the API runs, moved into a
 * host-neutral package — PRD 31 §W11 phase 2) and its `emitManifest` adapter. Pure.
 */
import { detectApp, emitManifest } from "@builderforce/app-detect";
import type { DetectedManifest } from "./manifestInit";

export function detectWorkspaceManifest(files: Map<string, string>): DetectedManifest {
  const detection = detectApp(files);
  const { manifest, text, notes } = emitManifest(detection.blueprint, {
    composeResources: detection.composeResources,
    // The /api ingress is written only on what the workspace files show (a dev proxy, backend routes).
    ingressEvidence: detection.ingressEvidence,
  });
  return {
    text,
    services: Object.keys(manifest.services),
    resources: Object.keys(manifest.resources ?? {}),
    // Detection's own warnings are notes too: never dropped silently. Coded, so the reply words them in the editor's language.
    notes: [...detection.metadata.warnings, ...notes],
    recognised: detection.metadata.confidence > 0,
  };
}
