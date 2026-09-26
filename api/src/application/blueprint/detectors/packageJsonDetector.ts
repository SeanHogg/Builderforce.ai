/**
 * W2: package.json detector
 * 
 * Detects:
 * - Package manager (npm, yarn, pnpm)
 * - Scripts (dev, build, start)
 * - Dependencies that indicate the framework
 * - Workspaces for monorepos
 */

import type { AppBlueprint, AppService } from '@builderforce/creation-canvas-contract';
import type { BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';

interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  type?: string;
  main?: string;
  module?: string;
}

/** Detect from package.json content. */
export function detectFromPackageJson(content: string): Partial<AppBlueprint> {
  const pkg: PackageJson = JSON.parse(content);
  const result: Partial<AppBlueprint> = {
    sources: { wranglerToml: false, packageJson: true, viteConfig: false, nextConfig: false, expoConfig: false, capacitorConfig: false, drizzleConfig: false, prismaSchema: false, dockerfile: false, envExample: false, githubWorkflows: false, builderforceJson: false },
    overrides: null,
  };

  const services: AppService[] = [];

  // Determine package manager
  let packageManager = 'npm';
  if (pkg.packageManager) {
    const pm = pkg.packageManager.split('@')[0];
    if (pm === 'yarn' || pm === 'pnpm') {
      packageManager = pm;
    }
  }

  // Detect framework from dependencies
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework = detectFramework(allDeps);
  
  // Build commands
  const devCommand = pkg.scripts?.dev || pkg.scripts?.['dev:watch'] || 'npm run dev';
  const buildCommand = pkg.scripts?.build || 'npm run build';
  const startCommand = pkg.scripts?.start || pkg.scripts?.['start:prod'] || 'npm start';

  const service: AppService = {
    id: pkg.name || 'main',
    kind: framework.kind,
    rootDir: '.',
    packageManager,
    installCommand: `${packageManager} install`,
    devCommand,
    buildCommand,
    startCommand,
    verifyCommand: null,
    outputDir: detectOutputDir(pkg, framework.kind),
    ports: [3000, 5173, 8787], // Common ports
    envVars: [],
    isPrimary: true,
  };

  services.push(service);

  // Detect monorepo (workspaces)
  if (pkg.workspaces) {
    result.isMonorepo = true;
    const workspacePkgs = Array.isArray(pkg.workspaces) 
      ? pkg.workspaces 
      : pkg.workspaces.packages || [];
    
    result.workspaces = workspacePkgs.map((dir: string) => ({
      path: dir,
      services: [], // Would be populated by deeper detection
    }));
  }

  // Detect output directory from build script
  if (pkg.scripts?.build) {
    const buildOutput = parseBuildOutput(pkg.scripts.build);
    if (buildOutput) {
      service.outputDir = buildOutput;
    }
  }

  result.services = services;
  return result;
}

function detectFramework(deps: Record<string, string>): { kind: string; framework: string } {
  // Check for frameworks in order of specificity
  if (deps['next'] || deps['react']) {
    if (deps['next']) {
      return { kind: SERVICE_KINDS.NEXTJS, framework: 'Next.js' };
    }
    return { kind: SERVICE_KINDS.VITE_REACT, framework: 'React (Vite)' };
  }
  
  if (deps['@sveltejs/kit'] || deps.svelte) {
    return { kind: SERVICE_KINDS.SVELTEKIT, framework: 'SvelteKit' };
  }
  
  if (deps['@remix-run/react'] || deps['@remix-run/dev']) {
    return { kind: SERVICE_KINDS.REMIX, framework: 'Remix' };
  }
  
  if (deps['vue'] || deps['@vitejs/plugin-vue']) {
    return { kind: SERVICE_KINDS.VITE_VUE, framework: 'Vue (Vite)' };
  }
  
  if (deps['wrangler']) {
    return { kind: SERVICE_KINDS.WORKER, framework: 'Cloudflare Worker' };
  }
  
  if (deps['@astrojs/core'] || deps.astro) {
    return { kind: SERVICE_KINDS.ASTRO, framework: 'Astro' };
  }

  // Default to generic node
  return { kind: SERVICE_KINDS.NODE, framework: 'Node.js' };
}

function detectOutputDir(pkg: PackageJson, kind: string): string {
  // Check common output directories based on framework
  if (kind === SERVICE_KINDS.NEXTJS) {
    return '.next';
  }
  if (kind === SERVICE_KINDS.REMIX) {
    return 'build';
  }
  if (kind === SERVICE_KINDS.ASTRO) {
    return 'dist';
  }
  
  // Check for custom output in package.json
  if (pkg.exports?.['.']?.import) {
    return 'dist';
  }
  
  return 'dist';
}

function parseBuildOutput(script: string): string | null {
  // Parse common build output flags
  if (script.includes('--outDir')) {
    const match = script.match(/--outDir[=\s]+(\S+)/);
    return match?.[1] || null;
  }
  
  // Remix
  if (script.includes('remix build')) {
    return 'build';
  }
  
  // Next.js
  if (script.includes('next build')) {
    return '.next';
  }

  return null;
}

/** Package.json detector */
export const packageJsonDetector: BlueprintDetector = {
  id: 'package-json',
  name: 'Node Package',
  reads: ['package.json'],
  detect: (files: Map<string, string>) => {
    const pkg = files.get('package.json');
    if (pkg) {
      return detectFromPackageJson(pkg);
    }
    return {};
  },
};
