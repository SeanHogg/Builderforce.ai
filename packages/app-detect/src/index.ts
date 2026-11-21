/**
 * `@builderforce/app-detect` — app detection, host-neutral and pure (PRD 31 §W2, §W11 phase 2).
 * A barrel only: the pipeline, the detector registry, the blueprint ↔ manifest adapter.
 */

export type {
  AppDetection,
  AppDetector,
  ComposeResource,
  ComposeResourceType,
  DetectionFindings,
  DetectOptions,
  DetectorFindings,
  IngressEvidence,
} from './types';

export {
  detectionNote,
  noteFrom,
  noteMessages,
  type DetectionNote,
  type DetectionNoteCode,
  type DetectionNoteParams,
} from './notes';

export { buildBlueprint, detectApp, detectBlueprint, type DetectAppOptions } from './detectApp';
export { applyOverrides } from './blueprintOverrides';
export { DETECTOR_BY_ID, DETECTORS, runDetectors } from './detectors';
export { escapeRegExp, pathGlobRegExp, pathGlobSource, repoRelativePath } from './pathGlob';

// Individual detectors' pure readers (tests and hosts that read one format).
export { builderforceJsonDetector } from './detectors/builderforceJsonDetector';
export { detectIngressEvidence, ingressEvidenceDetector } from './detectors/ingressEvidenceDetector';
export { COMPOSE_FILES, composeDetector, detectFromCompose, imageName } from './detectors/composeDetector';
export { detectDotnet } from './detectors/dotnetDetector';
export { parseYaml, yamlMap, yamlScalar, type YamlValue } from './detectors/minimalYaml';

// The blueprint ↔ builderforce.json v1 adapter.
export {
  emitManifest,
  INSTALL_SUFFIX,
  MANIFEST_RESERVED_IDS,
  SCHEDULED_ROUTE,
  type EmitManifestExtras,
  type EmitManifestResult,
} from './manifest/emitManifest';
export { manifestToBlueprintOverrides, type ManifestOverridesResult } from './manifest/manifestToBlueprintOverrides';
export {
  BACKEND_INGRESS_PATH,
  LEGACY_MANIFEST_PATHS,
  MANIFEST_DIR,
  MANIFEST_FILE_NAME,
  MANIFEST_PATH,
  MANIFEST_READ_PATHS,
  MANIFEST_SCHEMA_URL,
  type EmittedIngressRoute,
  type EmittedManifest,
  type EmittedReadiness,
  type EmittedResource,
  type EmittedRestart,
  type EmittedService,
  type ManifestInput,
  type ManifestServiceInput,
} from './manifest/manifestShape';
export { KIND_MANIFEST_RUNTIME, runtimeRoot, safeId } from './manifest/serviceRuntime';
