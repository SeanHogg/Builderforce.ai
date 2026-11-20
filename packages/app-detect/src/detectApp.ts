/**
 * W2 / W11: the detection pipeline, pure — files in, blueprint out. Run every detector
 * (`runDetectors`), fill the gaps with defaults (`buildBlueprint`), then lay
 * `builderforce.json`'s overrides over the result (`applyOverrides`).
 *
 * Every host detects through it: the API over a repo's files (`detectBlueprintForProject`
 * reads them and stores the result), the VS Code extension over a workspace folder
 * (`/manifest init`), the web app over a project's files.
 */

import type { AppBlueprint, BlueprintSourceFlags } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import { applyOverrides } from './blueprintOverrides';
import { DETECTORS, runDetectors } from './detectors';
import type { AppDetection, DetectOptions } from './types';

export interface DetectAppOptions extends DetectOptions {
  /** The project the blueprint belongs to; 0 when there is none (a local folder). */
  projectId?: number;
  /** The commit the files are from; `''` when there is none (a working tree). */
  commitSha?: string;
}

/** Build a complete AppBlueprint from partial detection results. */
export function buildBlueprint(partial: Partial<AppBlueprint>, projectId: number, commitSha: string): AppBlueprint {
  return {
    id: `${projectId}-${commitSha}`,
    projectId,
    commitSha,
    detectedAt: new Date(),
    services: partial.services || [{
      id: 'main',
      kind: SERVICE_KINDS.NODE,
      rootDir: '.',
      packageManager: 'npm',
      installCommand: 'npm install',
      devCommand: 'npm run dev',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
      verifyCommand: null,
      outputDir: 'dist',
      ports: [3000],
      envVars: [],
      isPrimary: true,
    }],
    bindings: partial.bindings || [],
    database: partial.database || null,
    secrets: partial.secrets || [],
    vars: partial.vars || [],
    domains: partial.domains || [],
    sources: partial.sources || {
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
    },
    overrides: partial.overrides || null,
    isMonorepo: partial.isMonorepo || false,
    workspaces: partial.workspaces || [],
  };
}

const anySource = (sources: BlueprintSourceFlags | undefined): boolean => Object.values(sources ?? {}).some(Boolean);

/**
 * Detect an app from its files: the blueprint, the detection metadata (which detectors ran,
 * every warning — an unreadable `builderforce.json`, an unsupported compose image, a detector
 * that threw — coded), and what the blueprint has no field for that `emitManifest` reads:
 * the compose resources and the ingress evidence.
 * `confidence` is 1 when any source file was recognised (or a compose file / services were read), 0 when the
 * blueprint is only the defaults.
 */
export function detectApp(files: Map<string, string>, options: DetectAppOptions = {}): AppDetection {
  const findings = runDetectors(files, options);
  const detected = buildBlueprint(findings, options.projectId ?? 0, options.commitSha ?? '');
  const recognised = anySource(findings.sources) || (findings.services?.length ?? 0) > 0 || findings.composeResources.length > 0;
  return {
    blueprint: applyOverrides(detected, detected.overrides),
    metadata: {
      detectorsRun: DETECTORS.map((detector) => detector.id),
      warnings: findings.warnings,
      confidence: recognised ? 1 : 0,
    },
    composeResources: findings.composeResources,
    ingressEvidence: findings.ingressEvidence,
  };
}

/** The blueprint alone (`detectApp(...).blueprint`). */
export function detectBlueprint(files: Map<string, string>, projectId: number, commitSha: string, options: DetectOptions = {}): AppBlueprint {
  return detectApp(files, { ...options, projectId, commitSha }).blueprint;
}
