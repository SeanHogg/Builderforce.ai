/**
 * W2: Blueprint Detection Service
 * 
 * Service to detect app blueprints from project files.
 * This is the main entry point for blueprint detection.
 */

import { db } from '../../infrastructure/database/postgres';
import { projectAppBlueprints } from '../../infrastructure/database/schema/delivery';
import { eq, and } from 'drizzle-orm';
import { runDetectors } from './detectors';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

export interface DetectBlueprintOptions {
  projectId: number;
  commitSha: string;
  repoDir: string; // Path to the repo on disk
}

/**
 * Detect and store an app blueprint for a project at a specific commit.
 */
export async function detectAndStoreBlueprint(options: DetectBlueprintOptions): Promise<AppBlueprint> {
  const { projectId, commitSha, repoDir } = options;
  
  // 1. Read files from the repo
  const files = await readRepoFiles(repoDir);
  
  // 2. Run detectors
  const partial = runDetectors(files);
  
  // 3. Build the complete blueprint
  const blueprint = buildBlueprint(partial, projectId, commitSha);
  
  // 4. Store in database
  await storeBlueprint(projectId, commitSha, blueprint);
  
  return blueprint;
}

/**
 * Get a stored blueprint for a project at a specific commit.
 */
export async function getBlueprint(projectId: number, commitSha: string): Promise<AppBlueprint | null> {
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
export async function getLatestBlueprint(projectId: number): Promise<AppBlueprint | null> {
  const row = await db
    .select()
    .from(projectAppBlueprints)
    .where(eq(projectAppBlueprints.projectId, projectId))
    .orderBy(projectAppBlueprints.detectedAt)
    .limit(1);
  
  if (!row[0]) {
    return null;
  }
  
  return row[0].blueprint as unknown as AppBlueprint;
}

/**
 * Read relevant files from the repo for detection.
 */
async function readRepoFiles(repoDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const filesToRead = [
    'package.json',
    'wrangler.toml',
    'wrangler.jsonc',
    'vite.config.ts',
    'vite.config.js',
    'next.config.js',
    'next.config.mjs',
    'app.json',
    'capacitor.config.ts',
    'drizzle.config.ts',
    'schema.prisma',
    'Dockerfile',
    '.env.example',
    'builderforce.json',
  ];
  
  for (const file of filesToRead) {
    try {
      const filePath = path.join(repoDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      files.set(file, content);
    } catch {
      // File doesn't exist, skip
    }
  }
  
  // Also look for GitHub workflows
  try {
    const workflowDir = path.join(repoDir, '.github', 'workflows');
    const workflowFiles = await fs.readdir(workflowDir);
    for (const file of workflowFiles) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        const content = await fs.readFile(path.join(workflowDir, file), 'utf-8');
        files.set(`.github/workflows/${file}`, content);
      }
    }
  } catch {
    // No workflows directory
  }
  
  return files;
}

/**
 * Build a complete AppBlueprint from partial detection results.
 */
function buildBlueprint(partial: any, projectId: number, commitSha: string): AppBlueprint {
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
async function storeBlueprint(
  projectId: number,
  commitSha: string,
  blueprint: AppBlueprint
): Promise<void> {
  await db
    .insert(projectAppBlueprints)
    .values({
      projectId,
      commitSha,
      blueprint: blueprint as any,
      detectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [projectAppBlueprints.projectId, projectAppBlueprints.commitSha],
      set: {
        blueprint: blueprint as any,
        detectedAt: new Date(),
      },
    });
}
