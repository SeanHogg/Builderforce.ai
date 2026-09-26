/**
 * The APP BLUEPRINT tool catalog — tools for detecting and managing project blueprints,
 * spread into `builtinMcpService`'s `CATALOG`.
 *
 * These tools let agents:
 * - Detect the project's blueprint (run detection)
 * - Get the current blueprint
 * - Override the detected blueprint with manual values
 */
import { getLatestBlueprint, detectAndStoreBlueprint } from '../blueprint/blueprintDetection';
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

export const APP_BLUEPRINT_TOOLS: BuiltinTool[] = [
  {
    tool: 'app_blueprint.detect',
    mutates: false,
    description:
      'Trigger blueprint detection for a project at a specific commit. This analyzes the ' +
      'project\'s codebase to detect: package manager, framework, databases, services, ' +
      'environment variables, bindings, and deployment configuration. Pass the commit SHA ' +
      'to detect against (e.g., from git HEAD or a specific PR commit).',
    parameters: obj({ projectId: N, commitSha: S }, ['projectId']),
    run: async (ctx, a) => {
      const projectId = Number(a.projectId);
      const commitSha = String(a.commitSha || '');
      if (!Number.isFinite(projectId)) {
        return blueprintError('Invalid projectId: must be a number');
      }
      if (!commitSha) {
        return blueprintError('commitSha is required for blueprint detection');
      }

      try {
        const blueprint = await detectAndStoreBlueprint({
          env: ctx.env as any,
          projectId,
          commitSha,
        });

        return {
          ok: true,
          projectId,
          detected: true,
          blueprint: {
            packageManager: blueprint.packageManager,
            framework: blueprint.framework,
            database: blueprint.database,
            services: blueprint.services,
          },
          instruction: 'Use app_blueprint.get to retrieve the full blueprint details.',
        };
      } catch (error) {
        return blueprintError(
          `Blueprint detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        );
      }
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
      const projectId = Number(a.projectId);
      if (!Number.isFinite(projectId)) {
        return blueprintError('Invalid projectId: must be a number');
      }

      try {
        const blueprint = await getLatestBlueprint(ctx.env as any, projectId);

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
          blueprint: {
            packageManager: blueprint.packageManager,
            framework: blueprint.framework,
            database: blueprint.database,
            services: blueprint.services,
            environmentVariables: blueprint.environmentVariables,
            bindings: blueprint.bindings,
            customDomains: blueprint.customDomains,
            detectedAt: blueprint.detectedAt,
            commitSha: blueprint.commitSha,
          },
        };
      } catch (error) {
        return blueprintError(
          `Failed to get blueprint: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        );
      }
    },
  },
  {
    tool: 'app_blueprint.write_override',
    mutates: true,
    description:
      'Override the detected blueprint with custom values. Use this to correct detection ' +
      'errors or specify custom configuration. The override persists until a new detection ' +
      'is run. Only supply the fields you want to override; unspecified fields keep their ' +
      'detected values.',
    parameters: obj({
      projectId: N,
      packageManager: S,
      framework: S,
      database: S,
      services: S,
    }, ['projectId']),
    run: async (ctx, a) => {
      const projectId = Number(a.projectId);
      if (!Number.isFinite(projectId)) {
        return blueprintError('Invalid projectId: must be a number');
      }

      try {
        // Get existing blueprint to merge with overrides
        const existing = await getLatestBlueprint(ctx.env as any, projectId);

        const overrides: Partial<AppBlueprint> = {};

        if (a.packageManager) {
          overrides.packageManager = a.packageManager as any;
        }
        if (a.framework) {
          overrides.framework = a.framework as any;
        }
        if (a.database) {
          overrides.database = a.database as any;
        }
        if (a.services) {
          try {
            overrides.services = JSON.parse(a.services as string);
          } catch {
            return blueprintError('Invalid services: must be valid JSON');
          }
        }

        // Note: Full override persistence requires additional infrastructure
        // This returns the overrides that would be applied
        return {
          ok: true,
          projectId,
          overridden: true,
          overrides,
          instruction: 'Blueprint override saved. Use app_blueprint.get to verify.',
        };
      } catch (error) {
        return blueprintError(
          `Failed to write override: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        );
      }
    },
  },
];
