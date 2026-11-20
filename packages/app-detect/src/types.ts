/**
 * The detection pipeline's own vocabulary, on top of the blueprint contract
 * (`@builderforce/creation-canvas-contract`): what a detector may report beyond blueprint
 * fields — warnings, and the resources a `docker-compose.yml` declares that `AppBlueprint`
 * has no field for (Redis, object storage, mail).
 */

import type { AppBlueprint, BlueprintDetectionResult, BlueprintDetector } from '@builderforce/creation-canvas-contract';
import type { DetectionNote } from './notes';

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

/**
 * What the files say about serving the one backend under `BACKEND_INGRESS_PATH` (`/api`)
 * — the runtime's ingress passes a path through unchanged, so an `/api` route is written
 * only on evidence that the backend answers there:
 * - `dev-proxy`: a frontend dev proxy forwards `/api` to the backend without rewriting it
 *   (`vite.config.*` `server.proxy['/api']`, Angular `proxy.conf.*`);
 * - `backend-routes`: the backend declares its routes under `/api` (express `app.use('/api'`,
 *   FastAPI `prefix="/api"`, Laravel `routes/api.php`, ASP.NET `MapGet("/api` …);
 * - `proxy-rewrite`: a dev proxy forwards `/api` but rewrites the path, so the backend
 *   serves somewhere else — evidence AGAINST the route.
 */
export interface IngressEvidence {
  kind: 'dev-proxy' | 'backend-routes' | 'proxy-rewrite';
  /** The file that says so (repo-relative). */
  file: string;
}

/** What one detector finds: blueprint fields, plus what it could not express as one. */
export interface DetectorFindings extends Partial<AppBlueprint> {
  /** One per finding, coded (`notes.ts` `warningFindings`) — never dropped silently; English is `noteMessages`. */
  warnings?: DetectionNote[];
  composeResources?: ComposeResource[];
  ingressEvidence?: IngressEvidence[];
}

/** A blueprint detector that may also report warnings and compose resources (`BlueprintDetector`-compatible). */
export interface AppDetector extends Omit<BlueprintDetector, 'detect'> {
  detect: (files: Map<string, string>) => DetectorFindings;
}

/** Every detector's findings merged (`runDetectors`). */
export interface DetectionFindings extends Partial<AppBlueprint> {
  warnings: DetectionNote[];
  composeResources: ComposeResource[];
  ingressEvidence: IngressEvidence[];
}

/** Options of the detection pipeline. */
export interface DetectOptions {
  /**
   * Told when a detector throws — the host's error sink (the API's `reportCaughtError`).
   * The failure is also a detection warning either way; one broken detector never sinks the rest.
   */
  onDetectorError?: (error: unknown, detectorId: string) => void;
}

/**
 * `detectApp`'s result: the blueprint, the detection metadata, and what `emitManifest`
 * reads beyond the blueprint (compose resources, ingress evidence). `metadata.warnings` is
 * coded — the ONE stored form; a host that needs `BlueprintDetectionResult`'s English
 * strings derives them with `noteMessages` (the API), one that localizes words each note.
 */
export interface AppDetection extends Omit<BlueprintDetectionResult, 'metadata'> {
  metadata: Omit<BlueprintDetectionResult['metadata'], 'warnings'> & { warnings: DetectionNote[] };
  composeResources: ComposeResource[];
  ingressEvidence: IngressEvidence[];
}
