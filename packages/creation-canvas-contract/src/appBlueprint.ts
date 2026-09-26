/**
 * AppBlueprint — a declarative description of what an app IS.
 * 
 * Detected once per project + commit, then read by:
 * - Run loop (W1): dev commands, ports, env
 * - Provision (W4): bindings, database, secrets
 * - Deploy (W6): build commands, output dir
 * - Marketplace (W7): listing metadata
 * 
 * This is the "one blueprint, many targets" principle from PRD 31.
 */

import { z } from 'zod';

/** The kind of runtime service detected in the project. */
export const SERVICE_KINDS = {
  WORKER: 'worker',       // Cloudflare Worker (Hono, Fastify, etc.)
  SPA: 'spa',             // Vite/Next.js SPA
  NODE: 'node',          // Node.js server (Express, etc.)
  CONTAINER: 'container', // Docker container
  MOBILE_EXPO: 'mobile-expo', // Expo React Native
  MOBILE_CAPACITOR: 'mobile-capacitor', // Capacitor (Ionic, etc.)
} as const;

export type ServiceKind = typeof SERVICE_KINDS[keyof typeof SERVICE_KINDS];

/** A single service in the app. */
export interface AppService {
  /** Unique identifier for this service within the app. */
  id: string;
  /** The kind of runtime. */
  kind: ServiceKind;
  /** Root directory of this service (relative to repo root). */
  rootDir: string;
  /** Detected package manager (npm/pnpm/yarn/bun). */
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Install command (with flags for CI/frozen lockfile). */
  installCommand: string;
  /** Dev server command. */
  devCommand: string;
  /** Build command. */
  buildCommand: string;
  /** Start command (production). */
  startCommand: string;
  /** Verify command (tests, type-check). */
  verifyCommand: string | null;
  /** Output directory (for static/deployed artifacts). */
  outputDir: string | null;
  /** Ports this service exposes (for preview). */
  ports: number[];
  /** Environment variables this service needs. */
  envVars: string[];
  /** Whether this service is the primary/entrypoint. */
  isPrimary: boolean;
}

/** Cloudflare binding types. */
export const BINDING_KINDS = {
  DURABLE_OBJECT: 'durableObject',
  R2: 'r2',
  KV: 'kv',
  D1: 'd1',
  QUEUE: 'queue',
  CRON: 'cron',
  AI: 'ai',
  VECTORIZE: 'vectorize',
  BROWSER: 'browser',
} as const;

export type BindingKind = typeof BINDING_KINDS[keyof typeof BINDING_KINDS];

/** A Cloudflare binding used by the app. */
export interface AppBinding {
  /** Binding name as used in code. */
  name: string;
  /** The kind of binding. */
  kind: BindingKind;
  /** For Durable Objects: the class name. */
  className?: string;
  /** For cron: the schedule expression. */
  cron?: string;
  /** Migration files for this binding (if applicable). */
  migrations?: string[];
  /** Whether this binding is required or optional. */
  required: boolean;
}

/** Database engine types. */
export const DATABASE_ENGINES = {
  NEON: 'neon',
  D1: 'd1',
  TURSO: 'turso',
  POSTGRES: 'postgres',
  MYSQL: 'mysql',
  MONGODB: 'mongodb',
} as const;

export type DatabaseEngine = typeof DATABASE_ENGINES[keyof typeof DATABASE_ENGINES];

/** Database configuration for the app. */
export interface AppDatabase {
  /** The database engine. */
  engine: DatabaseEngine;
  /** Migration command (e.g., "drizzle-kit push", "prisma migrate deploy"). */
  migrationCommand: string;
  /** Seed command (optional). */
  seedCommand: string | null;
  /** Path to migrations directory. */
  migrationsPath: string;
  /** Connection string secret name (for vault). */
  connectionSecretName: string;
}

/** A secret the app requires. */
export interface AppSecret {
  /** Secret name. */
  name: string;
  /** Whether it's required or optional. */
  required: boolean;
  /** Description/hint from detection (e.g., from wrangler.toml comments). */
  description?: string;
}

/** A non-secret environment variable. */
export interface AppVar {
  /** Variable name. */
  name: string;
  /** Default value if detected. */
  defaultValue?: string;
  /** Description. */
  description?: string;
}

/** Custom domain configuration. */
export interface AppDomain {
  /** Domain name. */
  domain: string;
  /** Zone ID (for Cloudflare). */
  zoneId?: string;
  /** Whether it's a production domain. */
  isProduction: boolean;
}

/** The complete blueprint for an app. */
export interface AppBlueprint {
  /** Unique identifier (project_id + commit_sha). */
  id: string;
  /** Project ID this blueprint belongs to. */
  projectId: number;
  /** Commit SHA this blueprint was detected from. */
  commitSha: string;
  /** When this blueprint was detected. */
  detectedAt: Date;
  /** All services in this app. */
  services: AppService[];
  /** All bindings this app uses. */
  bindings: AppBinding[];
  /** Database configuration (if any). */
  database: AppDatabase | null;
  /** Secrets required by this app. */
  secrets: AppSecret[];
  /** Non-secret environment variables. */
  vars: AppVar[];
  /** Custom domains configured. */
  domains: AppDomain[];
  /** Raw detection sources (for debugging/override). */
  sources: {
    wranglerToml: boolean;
    packageJson: boolean;
    viteConfig: boolean;
    nextConfig: boolean;
    expoConfig: boolean;
    capacitorConfig: boolean;
    drizzleConfig: boolean;
    prismaSchema: boolean;
    dockerfile: boolean;
    envExample: boolean;
    githubWorkflows: boolean;
    builderforceJson: boolean;
  };
  /** Override values from builderforce.json (merged over detection). */
  overrides: Partial<AppBlueprint> | null;
  /** Whether this is a monorepo (detected from package.json workspaces). */
  isMonorepo: boolean;
  /** Workspace packages (for monorepos). */
  workspaces: { path: string; services: string[] }[];
}

/** The source files that were used to detect this blueprint. */
export interface BlueprintSourceFlags {
  wranglerToml: boolean;
  packageJson: boolean;
  viteConfig: boolean;
  nextConfig: boolean;
  expoConfig: boolean;
  capacitorConfig: boolean;
  drizzleConfig: boolean;
  prismaSchema: boolean;
  dockerfile: boolean;
  envExample: boolean;
  githubWorkflows: boolean;
  builderforceJson: boolean;
}

/** Zod schema for validating AppBlueprint JSON. */
export const AppBlueprintSchema = z.object({
  id: z.string(),
  projectId: z.number(),
  commitSha: z.string(),
  detectedAt: z.string().datetime(),
  services: z.array(z.object({
    id: z.string(),
    kind: z.enum(Object.values(SERVICE_KINDS)),
    rootDir: z.string(),
    packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
    installCommand: z.string(),
    devCommand: z.string(),
    buildCommand: z.string(),
    startCommand: z.string(),
    verifyCommand: z.string().nullable(),
    outputDir: z.string().nullable(),
    ports: z.array(z.number()),
    envVars: z.array(z.string()),
    isPrimary: z.boolean(),
  })),
  bindings: z.array(z.object({
    name: z.string(),
    kind: z.enum(Object.values(BINDING_KINDS)),
    className: z.string().optional(),
    cron: z.string().optional(),
    migrations: z.array(z.string()).optional(),
    required: z.boolean(),
  })),
  database: z.object({
    engine: z.enum(Object.values(DATABASE_ENGINES)),
    migrationCommand: z.string(),
    seedCommand: z.string().nullable(),
    migrationsPath: z.string(),
    connectionSecretName: z.string(),
  }).nullable(),
  secrets: z.array(z.object({
    name: z.string(),
    required: z.boolean(),
    description: z.string().optional(),
  })),
  vars: z.array(z.object({
    name: z.string(),
    defaultValue: z.string().optional(),
    description: z.string().optional(),
  })),
  domains: z.array(z.object({
    domain: z.string(),
    zoneId: z.string().optional(),
    isProduction: z.boolean(),
  })),
  sources: z.object({
    wranglerToml: z.boolean(),
    packageJson: z.boolean(),
    viteConfig: z.boolean(),
    nextConfig: z.boolean(),
    expoConfig: z.boolean(),
    capacitorConfig: z.boolean(),
    drizzleConfig: z.boolean(),
    prismaSchema: z.boolean(),
    dockerfile: z.boolean(),
    envExample: z.boolean(),
    githubWorkflows: z.boolean(),
    builderforceJson: z.boolean(),
  }),
  overrides: z.any().nullable(),
  isMonorepo: z.boolean(),
  workspaces: z.array(z.object({
    path: z.string(),
    services: z.array(z.string()),
  })),
});

/** Detect an AppBlueprint from a repo's files. */
export interface BlueprintDetector {
  /** Unique identifier for this detector. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Files this detector reads. */
  reads: string[];
  /** Detect from file contents. */
  detect: (files: Map<string, string>) => Partial<AppBlueprint>;
}

/** Result of running all detectors. */
export interface BlueprintDetectionResult {
  /** The detected blueprint. */
  blueprint: AppBlueprint;
  /** Detection metadata. */
  metadata: {
    /** Which detectors ran. */
    detectorsRun: string[];
    /** Any warnings during detection. */
    warnings: string[];
    /** Detection confidence (0-1). */
    confidence: number;
  };
}
