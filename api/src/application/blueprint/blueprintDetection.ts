/**
 * W2: Blueprint Detection Service
 *
 * The pure detection step (`detectBlueprint`) and the blueprint store. It reads no
 * repo itself: `readBlueprintSources` fetches the files, and `detectBlueprintForProject`
 * is the one use case that wires a project's repo + credential through both.
 */

import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { projectAppBlueprints } from '../../infrastructure/database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { runDetectors } from './detectors';
import { applyOverrides } from './blueprintOverrides';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import type { Env } from '../../env';

/**
 * Detect a blueprint from a repo's source files — pure: run every detector, fill the
 * gaps with defaults, then lay `builderforce.json`'s overrides over the result.
 * Reading the files is `readBlueprintSources`; the use case that wires the two
 * together with a project's repo and credential is `detectBlueprintForProject`.
 */
export function detectBlueprint(files: Map<string, string>, projectId: number, commitSha: string): AppBlueprint {
  const detected = buildBlueprint(runDetectors(files), projectId, commitSha);
  return applyOverrides(detected, detected.overrides);
}

/**
 * Get a stored blueprint for a project at a specific commit.
 */
export async function getBlueprint(env: Env, projectId: number, commitSha: string): Promise<AppBlueprint | null> {
  const db = buildDatabase(env);
  const row = await db
    .select()
    .from(projectAppBlueprints)
    .where(and(
      eq(projectAppBlueprints.projectId, projectId),
      eq(projectAppBlueprints.commitSha, commitSha)
    ))
    .limit(1);
  
  if (!row[0]) {
    return null;
  }
  
  return row[0].blueprint as unknown as AppBlueprint;
}

/**
 * Get the latest blueprint for a project.
 */
export async function getLatestBlueprint(env: Env, projectId: number): Promise<AppBlueprint | null> {
  const db = buildDatabase(env);
  const row = await db
    .select()
    .from(projectAppBlueprints)
    .where(eq(projectAppBlueprints.projectId, projectId))
    .orderBy(desc(projectAppBlueprints.detectedAt))
    .limit(1);
  
  if (!row[0]) {
    return null;
  }
  
  return row[0].blueprint as unknown as AppBlueprint;
}

/**
 * Build a complete AppBlueprint from partial detection results.
 */
function buildBlueprint(partial: Partial<AppBlueprint>, projectId: number, commitSha: string): AppBlueprint {
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

/**
 * Store a blueprint in the database.
 */
export async function storeBlueprint(
  db: Db,
  projectId: number,
  commitSha: string,
  blueprint: AppBlueprint
): Promise<void> {
  await db
    .insert(projectAppBlueprints)
    .values({
      projectId,
      commitSha,
      blueprint,
      detectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [projectAppBlueprints.projectId, projectAppBlueprints.commitSha],
      set: {
        blueprint,
        detectedAt: new Date(),
      },
    });
}
