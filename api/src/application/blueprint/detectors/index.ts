/**
 * W2: Blueprint Detector Registry
 * 
 * Central registry for all blueprint detectors.
 * Detectors are discovered and composed here.
 */

import type { BlueprintDetector, AppBlueprint, BlueprintSourceFlags } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

// Import all detectors
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

/** All available detectors */
export const DETECTORS: BlueprintDetector[] = [
  wranglerDetector,
  packageJsonDetector,
  viteConfigDetector,
  nextConfigDetector,
  expoConfigDetector,
  capacitorConfigDetector,
  drizzleConfigDetector,
  prismaSchemaDetector,
  dockerfileDetector,
  envExampleDetector,
  githubWorkflowsDetector,
];

/** Detector by ID */
export const DETECTOR_BY_ID: Map<string, BlueprintDetector> = new Map(
  DETECTORS.map(d => [d.id, d])
);

/**
 * Run all detectors on a set of files.
 * Results are merged with later detectors overriding earlier ones.
 */
export function runDetectors(files: Map<string, string>): Partial<AppBlueprint> {
  const result: Partial<AppBlueprint> = {
    sources: createEmptySources(),
    overrides: null,
  };

  for (const detector of DETECTORS) {
    try {
      const detectorResult = detector.detect(files);
      
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
      console.error(`Detector ${detector.id} failed:`, error);
      // Continue with other detectors
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

function mergeServices(existing: any[], incoming: any[]): any[] {
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
