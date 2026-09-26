/**
 * W2: Blueprint Detection Service
 * 
 * Service to detect app blueprints from project files.
 * This is the main entry point for blueprint detection.
 */

import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { projectAppBlueprints } from '../../infrastructure/database/schema';
import { eq, and } from 'drizzle-orm';
import { runDetectors } from './detectors';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import type { Env } from '../../env';

export interface DetectBlueprintOptions {
  projectId: number;
  commitSha: string;
  repoDir?: string; // Path to the repo on disk (for local dev)
  env: Env; // For database access
  /** GitHub token for reading files via API (for cloud deployment) */
  githubToken?: string;
  /** GitHub owner/repo (e.g., "owner/repo") for remote reading */
  githubRepo?: string;
}

/**
 * Detect and store an app blueprint for a project at a specific commit.
 */
export async function detectAndStoreBlueprint(options: DetectBlueprintOptions): Promise<AppBlueprint> {
  const { projectId, commitSha, repoDir, env, githubToken, githubRepo } = options;
  const db = buildDatabase(env);
  
  // 1. Read files from the repo (local or remote)
  let files: Map<string, string>;
  if (githubToken && githubRepo) {
    // Read from GitHub API
    files = await readRepoFilesFromGitHub(githubToken, githubRepo, commitSha);
  } else if (repoDir) {
    // Read from local filesystem
    files = await readRepoFiles(repoDir);
  } else {
    throw new Error('Either repoDir or (githubToken + githubRepo) must be provided');
  }
  
  // 2. Run detectors
  const partial = runDetectors(files);
  
  // 3. Build the complete blueprint
  const blueprint = buildBlueprint(partial, projectId, commitSha);
  
  // 4. Store in database
  await storeBlueprint(db, projectId, commitSha, blueprint);
  
  return blueprint;
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
 * Read relevant files from the repo via GitHub API.
 */
async function readRepoFilesFromGitHub(
  token: string,
  repo: string, // "owner/repo"
  ref: string // commit SHA or branch
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  
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

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BuilderForce-Blueprint/1.0',
  };

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
  }

  for (const file of filesToRead) {
    try {
      const url = `https://api.github.com/repos/${owner}/${repoName}/contents/${file}?ref=${ref}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        if (response.status !== 404) {
          console.warn(`Failed to fetch ${file}: ${response.status}`);
        }
        continue;
      }
      const data = await response.json() as { content?: string; encoding?: string };
      if (data.content && data.encoding === 'base64') {
        const content = atob(data.content.replace(/\n/g, ''));
        files.set(file, content);
      }
    } catch {
      // Skip file on error
    }
  }

  // Also look for GitHub workflows
  try {
    const workflowUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/.github/workflows?ref=${ref}`;
    const workflowResponse = await fetch(workflowUrl, { headers });
    if (workflowResponse.ok) {
      const workflowData = await workflowResponse.json() as Array<{ name: string; content?: string; encoding?: string }>;
      for (const file of workflowData) {
        if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
          try {
            // Need to fetch each workflow file content separately
            const fileUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/.github/workflows/${file.name}?ref=${ref}`;
            const fileResponse = await fetch(fileUrl, { headers });
            if (fileResponse.ok) {
              const fileData = await fileResponse.json() as { content?: string; encoding?: string };
              if (fileData.content && fileData.encoding === 'base64') {
                const content = atob(fileData.content.replace(/\n/g, ''));
                files.set(`.github/workflows/${file.name}`, content);
              }
            }
          } catch {
            // Skip on error
          }
        }
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
