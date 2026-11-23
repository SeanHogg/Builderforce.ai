/**
 * The APP MANIFEST tool catalog — `app_manifest.schema` and `app_manifest.validate`, spread into
 * `builtinMcpService`'s `CATALOG` (docs/specs/app-manifest-ai-resource.md §8).
 *
 * There is exactly one schema and one validator: the runtime's own, from
 * `@seanhogg/builderforce-webcontainers-core/manifest` (the pure core export). This file only
 * adapts them to the tool shape; it never restates a field, rule or capability.
 */
import {
  APP_MANIFEST_SCHEMA_V1,
  RESOURCE_CAPABILITIES,
  describeManifestIssue,
  manifestHasErrors,
  parseManifest,
  toApplicationSpec,
  validateManifest,
  type ManifestIssue,
  type ManifestTargetId,
} from '@seanhogg/builderforce-webcontainers-core/manifest';
import { type BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the other catalogs use) ---
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

const TARGETS: readonly ManifestTargetId[] = ['browser', 'cloudflare', 'aws', 'azure', 'gcp'];
const DEFAULT_TARGET: ManifestTargetId = 'browser';

/** A short field guide beside the schema, so the agent need not infer the rules from it. */
const FIELD_GUIDE = [
  'version must be 1.',
  'Every service requires `runtime` and `command`.',
  'A service `role` is one of the roles the schema enumerates; `uses` names resources declared in `resources`.',
  'An `ai` resource gives a service AI_BASE_URL; no key ever lives in the process or the repo.',
  'Environment overrides (`environments`) may only change entries the base manifest already has.',
];

function manifestToolError(message: string, details?: Json): Json {
  return { ok: false as const, error: message, ...details };
}

function isTarget(raw: unknown): raw is ManifestTargetId {
  return typeof raw === 'string' && (TARGETS as readonly string[]).includes(raw);
}

/** Each issue as the typed record plus the one-line sentence a person reads. */
function describeIssues(issues: readonly ManifestIssue[]): Array<ManifestIssue & { message: string }> {
  return issues.map((issue) => ({ ...issue, message: describeManifestIssue(issue) }));
}

export const APP_MANIFEST_TOOLS: BuiltinTool[] = [
  {
    tool: 'app_manifest.schema',
    mutates: false,
    description:
      'Get the app manifest v1 (builderforce.json) JSON schema, a short field guide, and the resource ' +
      'capability matrix for a deployment target (browser, cloudflare, aws, azure, gcp; default browser) — ' +
      'which resources, including the ai resource, that target can host. Read this before writing a manifest.',
    parameters: obj({ target: { ...S, enum: [...TARGETS] } }),
    run: async (_ctx, a) => {
      if (a.target !== undefined && !isTarget(a.target)) {
        return manifestToolError(`Unknown target: expected one of ${TARGETS.join(', ')}`, { target: a.target });
      }
      const target: ManifestTargetId = isTarget(a.target) ? a.target : DEFAULT_TARGET;
      const capabilities = Object.fromEntries(
        Object.entries(RESOURCE_CAPABILITIES).map(([type, row]) => [type, row[target]]),
      );
      return { ok: true, target, schema: APP_MANIFEST_SCHEMA_V1, fieldGuide: FIELD_GUIDE, capabilities };
    },
  },
  {
    tool: 'app_manifest.validate',
    mutates: false,
    description:
      'Validate an app manifest v1 (builderforce.json). Pass the manifest as `content` (a JSON string or an object). ' +
      'Returns { ok, errors, warnings, issues } from the runtime\'s own validator. With `environment`, also reports ' +
      'which resources that environment\'s target declines to host.',
    parameters: obj({ content: { description: 'The manifest: a JSON string or an object.' }, environment: S, projectId: N }),
    run: async (_ctx, a) => {
      if (a.path !== undefined) {
        return manifestToolError('Reading a manifest from the repo is not supported yet: pass the manifest as `content`.');
      }
      const text =
        typeof a.content === 'string' ? a.content
        : a.content && typeof a.content === 'object' ? JSON.stringify(a.content)
        : null;
      if (text === null || !text.trim()) return manifestToolError('Pass the manifest as `content` (a JSON string or an object).');

      const parsed = parseManifest(text);
      const issues: ManifestIssue[] = [...parsed.issues];
      let declined: Array<{ id: string; reason: string }> = [];
      if (parsed.manifest) {
        issues.push(...validateManifest(parsed.manifest));
        if (typeof a.environment === 'string' && a.environment.trim()) {
          const projectId = Number.isFinite(Number(a.projectId)) ? String(Number(a.projectId)) : 'validate';
          const spec = toApplicationSpec(parsed.manifest, a.environment.trim(), { projectId });
          issues.push(...spec.issues);
          declined = spec.declined;
        }
      }
      const described = describeIssues(issues);
      return {
        ok: !manifestHasErrors(issues),
        errors: described.filter((i) => i.severity === 'error'),
        warnings: described.filter((i) => i.severity !== 'error'),
        issues: described,
        ...(declined.length ? { declined } : {}),
      };
    },
  },
];
