/**
 * The detection pipeline's own vocabulary, on top of the blueprint contract
 * (`@builderforce/creation-canvas-contract`): what a detector may report beyond blueprint
 * fields — warnings, and the resources a `docker-compose.yml` declares that `AppBlueprint`
 * has no field for (Redis, object storage, mail).
 */

import type { AppBlueprint, BlueprintDetectionResult, BlueprintDetector } from '@builderforce/creation-canvas-contract';

/** A resource a compose file declares by a known image. */
export type ComposeResourceType = 'postgres' | 'redis' | 'object-storage' | 'mail';

export interface ComposeResource {
  /** The compose service name (`cache`, `db`). */
  id: string;
  type: ComposeResourceType;
  /** The image as written (`redis:7-alpine`). */
  image: string;
  /** Postgres extensions the image ships (`pgvector/pgvector` → `vector`). */
  extensions?: string[];
  /** Ids of the app services (by blueprint service id) whose `depends_on` names it. */
  usedBy: string[];
}

/** What one detector finds: blueprint fields, plus what it could not express as one. */
export interface DetectorFindings extends Partial<AppBlueprint> {
  /** Human-readable, one per finding — never dropped silently. */
  warnings?: string[];
  composeResources?: ComposeResource[];
}

/** A blueprint detector that may also report warnings and compose resources (`BlueprintDetector`-compatible). */
export interface AppDetector extends Omit<BlueprintDetector, 'detect'> {
  detect: (files: Map<string, string>) => DetectorFindings;
}

/** Every detector's findings merged (`runDetectors`). */
export interface DetectionFindings extends Partial<AppBlueprint> {
  warnings: string[];
  composeResources: ComposeResource[];
}

/** Options of the detection pipeline. */
export interface DetectOptions {
  /**
   * Told when a detector throws — the host's error sink (the API's `reportCaughtError`).
   * The failure is also a detection warning either way; one broken detector never sinks the rest.
   */
  onDetectorError?: (error: unknown, detectorId: string) => void;
}

/** `detectApp`'s result: the blueprint, the detection metadata, and the compose resources for `emitManifest`. */
export interface AppDetection extends BlueprintDetectionResult {
  composeResources: ComposeResource[];
}
