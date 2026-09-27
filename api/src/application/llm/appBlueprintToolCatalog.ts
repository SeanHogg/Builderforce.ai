/**
 * The APP BLUEPRINT tool catalog — tools for detecting and managing project blueprints,
 * spread into `builtinMcpService`'s `CATALOG`.
 *
 * These tools let agents:
 * - Detect the project's blueprint (run detection)
 * - Get the current blueprint
 *
 * There is deliberately no "write override" tool: the designed override path is a
 * repo-root `builderforce.json` (a partial AppBlueprint), which detection reads and
 * lays over what it found — so an override lives in the repo, versioned with the code.
 */
import { getLatestBlueprint } from '../blueprint/blueprintDetection';
import { detectBlueprintForProject } from '../blueprint/detectBlueprintForProject';
import { type AppBlueprint } from '@builderforce/creation-canvas-contract';
import { type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the main catalog uses) ---
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

/**
 * Error thrown when blueprint detection fails
 */
function blueprintError(message: string, details?: Json): Json {
  return { ok: false as const, error: message, ...details };
}

/** How an agent overrides detection — the one designed path, quoted by both tools. */
const OVERRIDE_HINT =
  'To override detection, write builderforce.json at the repo root (a partial AppBlueprint, ' +
  'e.g. { "services": [...] } or { "database": {...} }) with write_file, then run ' +
  'app_blueprint.detect again.';

/**
 * The one shape both tools reply with, so `detect` and `get` cannot drift. The contract
 * has no top-level package manager or framework — they are the primary service's.
 * Secrets are NAMES only: a tool result never echoes a value.
 */
function summarizeBlueprint(bp: AppBlueprint) {
  const primary = bp.services.find((s) => s.isPrimary) ?? bp.services[0];
  return {
    packageManager: primary?.packageManager ?? null,
    framework: primary?.kind ?? null,
    database: bp.database,
    services: bp.services,
    bindings: bp.bindings,
    secrets: bp.secrets.map((s) => s.name),
    vars: bp.vars,
    domains: bp.domains,
    isMonorepo: bp.isMonorepo,
    detectedAt: bp.detectedAt,
    commitSha: bp.commitSha,
  };
}

/**
 * The caller's own project, or a tool error. `projectId` is model-supplied and the
 * blueprint store is keyed by project alone, so this is the tenant boundary: a
 * foreign or unknown id is refused before anything is read or written.
 */
async function ownedProjectId(ctx: BuiltinCtx, raw: unknown): Promise<number | Json> {
  const projectId = Number(raw);
  if (!Number.isFinite(projectId)) return blueprintError('Invalid projectId: must be a number');
  try {
    await ctx.projects.getProject(projectId, ctx.tenantId);
    return projectId;
  } catch {
    return blueprintError('Project not found in this workspace', { projectId });
  }
}

export const APP_BLUEPRINT_TOOLS: BuiltinTool[] = [
  {
    tool: 'app_blueprint.detect',
    // It stores a blueprint row for the project.
    mutates: true,
    description:
      "Run blueprint detection for a project. This reads the project's default repository and " +
      'detects: package manager, framework, databases, services, environment variables, ' +
      'bindings, and deployment configuration, then applies any repo-root builderforce.json ' +
      "overrides. commitSha is optional and defaults to the head of the repo's default branch.",
    parameters: obj({ projectId: N, commitSha: S }, ['projectId']),
    run: async (ctx, a) => {
      if (!ctx.env) return blueprintError('detection needs the worker environment');
      const projectId = await ownedProjectId(ctx, a.projectId);
      if (typeof projectId !== 'number') return projectId;
      const commitSha = typeof a.commitSha === 'string' && a.commitSha.trim() ? a.commitSha.trim() : null;

      const result = await detectBlueprintForProject(ctx.db, ctx.env, { tenantId: ctx.tenantId, projectId, commitSha });
      if (!result.ok) return blueprintError(`Blueprint detection failed: ${result.reason}`, { projectId });
      return {
        ok: true,
        projectId,
        detected: true,
        blueprint: summarizeBlueprint(result.blueprint),
        instruction: OVERRIDE_HINT,
      };
    },
  },
  {
    tool: 'app_blueprint.get',
    mutates: false,
    description:
      'Get the detected blueprint for a project. Returns the full blueprint including: ' +
      'package manager, framework, databases, services, environment variables, bindings, ' +
      'and deployment configuration. Returns null if no blueprint has been detected yet.',
    parameters: obj({ projectId: N }, ['projectId']),
    run: async (ctx, a) => {
      if (!ctx.env) return blueprintError('reading a blueprint needs the worker environment');
      const projectId = await ownedProjectId(ctx, a.projectId);
      if (typeof projectId !== 'number') return projectId;

      try {
        const blueprint = await getLatestBlueprint(ctx.env, projectId);

        if (!blueprint) {
          return {
            ok: true,
            projectId,
            detected: false,
            blueprint: null,
            instruction: 'Use app_blueprint.detect to trigger detection for this project.',
          };
        }

        return {
          ok: true,
          projectId,
          detected: true,
          blueprint: summarizeBlueprint(blueprint),
          instruction: OVERRIDE_HINT,
        };
      } catch (error) {
        return blueprintError(
          `Failed to get blueprint: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        );
      }
    },
  },
];
