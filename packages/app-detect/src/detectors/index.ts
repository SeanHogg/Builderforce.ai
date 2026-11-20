/**
 * W2: Blueprint Detector Registry
 * 
 * Central registry for all blueprint detectors.
 * Detectors are discovered and composed here.
 */

import type { AppService, BlueprintSourceFlags } from '@builderforce/creation-canvas-contract';
import type { AppDetector, DetectionFindings, DetectOptions } from '../types';

// Import all detectors
import { composeDetector } from './composeDetector';
import { wranglerDetector } from './wranglerDetector';
import { packageJsonDetector } from './packageJsonDetector';
import { viteConfigDetector } from './viteConfigDetector';
import { nextConfigDetector } from './nextConfigDetector';
import { expoConfigDetector } from './expoConfigDetector';
import { capacitorConfigDetector } from './capacitorConfigDetector';
import { drizzleConfigDetector } from './drizzleConfigDetector';
import { prismaSchemaDetector } from './prismaSchemaDetector';
import { dockerfileDetector } from './dockerfileDetector';
import { envExampleDetector } from './envExampleDetector';
import { githubWorkflowsDetector } from './githubWorkflowsDetector';
import { builderforceJsonDetector } from './builderforceJsonDetector';
import { ingressEvidenceDetector } from './ingressEvidenceDetector';
import { pythonDetector } from './pythonDetector';
import { phpDetector } from './phpDetector';
import { dotnetDetector } from './dotnetDetector';
import { rustDetector } from './rustDetector';
import { detectionNote, errorText } from '../notes';

/** All available detectors */
export const DETECTORS: AppDetector[] = [
  // First: a compose build context is the coarsest reading of a service, so a detector that
  // reads the same root (Python in `api/`) and names it the same id refines it (`mergeServices`).
  composeDetector,
  wranglerDetector,
  packageJsonDetector,
  // Language services (root or a backend folder) — before the Node ORM configs, whose
  // `database` wins when a repo has both.
  pythonDetector,
  phpDetector,
  dotnetDetector,
  rustDetector,
  viteConfigDetector,
  nextConfigDetector,
  expoConfigDetector,
  capacitorConfigDetector,
  drizzleConfigDetector,
  prismaSchemaDetector,
  dockerfileDetector,
  envExampleDetector,
  githubWorkflowsDetector,
  builderforceJsonDetector,
  // Last: it adds no blueprint field, only evidence for `emitManifest`'s ingress, and its
  // globs take what is left of the read budget after every detector that names services.
  ingressEvidenceDetector,
];

/** Detector by ID */
export const DETECTOR_BY_ID: Map<string, AppDetector> = new Map(
  DETECTORS.map(d => [d.id, d])
);

/**
 * Run all detectors on a set of files.
 * Results are merged with later detectors overriding earlier ones; every detector's
 * warnings and compose resources are kept, and a detector that throws is a warning
 * (and is handed to `options.onDetectorError`) rather than the end of detection.
 */
export function runDetectors(files: Map<string, string>, options: DetectOptions = {}): DetectionFindings {
  const result: DetectionFindings = {
    sources: createEmptySources(),
    overrides: null,
    warnings: [],
    composeResources: [],
    ingressEvidence: [],
  };

  for (const detector of DETECTORS) {
    try {
      const detectorResult = detector.detect(files);

      if (detectorResult.warnings) result.warnings.push(...detectorResult.warnings);
      if (detectorResult.composeResources) result.composeResources.push(...detectorResult.composeResources);
      if (detectorResult.ingressEvidence) result.ingressEvidence.push(...detectorResult.ingressEvidence);

      // Merge sources
      if (detectorResult.sources) {
        result.sources = { ...result.sources, ...detectorResult.sources };
      }
      
      // Merge services (prefer later detectors)
      if (detectorResult.services) {
        result.services = mergeServices(result.services || [], detectorResult.services);
      }
      
      // Merge bindings
      if (detectorResult.bindings) {
        result.bindings = [...(result.bindings || []), ...detectorResult.bindings];
      }
      
      // Merge vars
      if (detectorResult.vars) {
        result.vars = [...(result.vars || []), ...detectorResult.vars];
      }
      
      // Merge secrets
      if (detectorResult.secrets) {
        result.secrets = [...(result.secrets || []), ...detectorResult.secrets];
      }
      
      // Merge database
      if (detectorResult.database) {
        result.database = detectorResult.database;
      }
      
      // Merge domains
      if (detectorResult.domains) {
        result.domains = [...(result.domains || []), ...detectorResult.domains];
      }
      
      // Merge overrides
      if (detectorResult.overrides) {
        result.overrides = { ...result.overrides, ...detectorResult.overrides };
      }

      // Copy monorepo flag
      if (detectorResult.isMonorepo !== undefined) {
        result.isMonorepo = detectorResult.isMonorepo;
      }

      // Copy workspaces
      if (detectorResult.workspaces) {
        result.workspaces = detectorResult.workspaces;
      }
    } catch (error) {
      // One broken detector must not sink detection — report it and run the rest.
      result.warnings.push(detectionNote('detector-failed', { detector: detector.id, error: errorText(error) }));
      options.onDetectorError?.(error, detector.id);
    }
  }

  return result;
}

function createEmptySources(): BlueprintSourceFlags {
  return {
    wranglerToml: false,
    packageJson: false,
    viteConfig: false,
    nextConfig: false,
    expoConfig: false,
    capacitorConfig: false,
    drizzleConfig: false,
    prismaSchema: false,
    dockerfile: false,
    envExample: false,
    githubWorkflows: false,
    builderforceJson: false,
  };
}

function mergeServices(existing: AppService[], incoming: AppService[]): AppService[] {
  if (!existing || existing.length === 0) {
    return incoming;
  }
  
  // Merge: incoming overrides existing by id
  const byId = new Map(existing.map(s => [s.id, s]));
  for (const service of incoming) {
    byId.set(service.id, { ...byId.get(service.id), ...service });
  }
  
  return Array.from(byId.values());
}
