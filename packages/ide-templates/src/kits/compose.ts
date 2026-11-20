/**
 * `composeKit` — kit id + extras → the files and the ONE `builderforce.json` v1 manifest
 * (PRD 31 §W11 "Starter kits"). Pure: no I/O; hosts write the result through their
 * `ScaffoldSink`.
 *
 * Parts merge by key, never by overwrite: two parts writing one path, declaring one
 * service id or one resource id are issues, and the first part's entry is kept. An
 * unknown kit or extra is an issue naming every valid id.
 */
import { findKitPart, KIT_PARTS, listKitOptions } from './registry';
import type {
  ComposedKit, KitDefinition, KitIssue, KitIssueCode, KitIssueParams, KitManifest, KitPart, ManifestResource, ManifestRoute,
  ManifestService,
} from './types';

export const MANIFEST_SCHEMA_URL = 'https://builderforce.ai/schema/app.v1.json';
export const MANIFEST_FILE = 'builderforce.json';
export const KIT_README_FILE = 'README.md';

/** Every kit environment: run locally in the browser with diagnostics, promote to Cloudflare. */
const kitEnvironments = (): KitManifest['environments'] => ({
  local: { target: 'browser', tier: 'non-production', debug: true },
  prod: { target: 'cloudflare', tier: 'production' },
});

const ids = (options: { id: string }[]) => options.map((option) => option.id);

/** The English default of each issue (`KitIssue.message`); localizing hosts word it from `code` + `params`. */
const ISSUE_ENGLISH: { [C in KitIssueCode]: (params: KitIssueParams[C]) => string } = {
  'unknown-kit': (p) =>
    `Unknown starter kit "${p.kit}". Use <frontend>-<backend> or a frontend alone. Named kits: ${p.namedKits.join(', ')}. Frontends: ${p.frontends.join(', ')}. Backends: ${p.backends.join(', ')}.`,
  'unknown-extra': (p) => `Unknown extra "${p.extra}". Extras: ${p.extras.join(', ')}.`,
  'missing-requirement': (p) => `"${p.part}" needs a ${p.kind} part in the kit.`,
  'path-conflict': (p) => `File "${p.key}" comes from both "${p.kept}" and "${p.dropped}"; kept "${p.kept}"'s.`,
  'service-conflict': (p) => `Service "${p.key}" comes from both "${p.kept}" and "${p.dropped}"; kept "${p.kept}"'s.`,
  'resource-conflict': (p) => `Resource "${p.key}" comes from both "${p.kept}" and "${p.dropped}"; kept "${p.kept}"'s.`,
  'unknown-service': (p) => `"${p.part}" adds to service "${p.service}", which no part in this kit declares.`,
};

/** An issue: its code, params, the English sentence, and the key it is about. */
function kitIssue<C extends KitIssueCode>(code: C, key: string, params: KitIssueParams[C]): KitIssue {
  return { code, key, params, message: ISSUE_ENGLISH[code](params) } as KitIssue;
}

/** `<frontend>-<backend>` (either by id or alias), or a frontend alone. */
export function resolveKit(kitId: string, extras: readonly string[] = []): { kit?: KitDefinition; issues: KitIssue[] } {
  const issues: KitIssue[] = [];
  const name = kitId.trim().toLowerCase();
  let frontend = findKitPart(name, 'frontend');
  let backend: KitPart | undefined;
  for (let at = name.indexOf('-'); !frontend && at > 0; at = name.indexOf('-', at + 1)) {
    const left = findKitPart(name.slice(0, at), 'frontend');
    const right = findKitPart(name.slice(at + 1), 'backend');
    if (left && right) [frontend, backend] = [left, right];
  }
  const options = listKitOptions();
  if (!frontend) {
    issues.push(kitIssue('unknown-kit', kitId, {
      kit: kitId, namedKits: options.namedKits, frontends: ids(options.frontends), backends: ids(options.backends),
    }));
  }
  const extraIds: string[] = [];
  for (const raw of extras) {
    const extra = findKitPart(raw, 'extra');
    if (!extra) issues.push(kitIssue('unknown-extra', raw, { extra: raw, extras: ids(options.extras) }));
    else if (!extraIds.includes(extra.id)) extraIds.push(extra.id);
  }
  if (!frontend) return { issues };
  const id = backend ? `${frontend.id}-${backend.id}` : frontend.id;
  return { kit: { id, frontend: frontend.id, ...(backend ? { backend: backend.id } : {}), extras: extraIds }, issues };
}

/** The README a kit ships at its root: what it is and how to run it. */
function kitReadme(name: string, parts: readonly KitPart[]): string {
  const lines = parts.map((part) => `- **${part.label}** (\`${part.id}\`) in \`${part.root.slice(1)}/\``);
  return `# ${name}

A Builderforce starter kit composed from:

${lines.join('\n')}

\`${MANIFEST_FILE}\` declares every service, resource and environment. To run the whole app:

- in Builderforce or the VS Code extension, type \`/launch\` in the composer (or choose **Run in browser**);
- \`/launch prod\` runs the production environment's settings.

The API answers \`GET /health\`, \`GET /api/items\` and \`POST /api/items\`; the web app calls it through \`/api\`.
`;
}

/** Merge the parts into one file tree and one manifest. Exported for hosts and tests composing parts directly. */
export function composeParts(name: string, parts: readonly KitPart[]): ComposedKit {
  const issues: KitIssue[] = [];
  const files: Record<string, string> = {};
  const services: Record<string, ManifestService> = {};
  const resources: Record<string, ManifestResource> = {};
  const owner = new Map<string, string>();

  const claim = (code: 'path-conflict' | 'service-conflict' | 'resource-conflict', key: string, partId: string): boolean => {
    const held = owner.get(`${code}:${key}`);
    if (held === undefined) {
      owner.set(`${code}:${key}`, partId);
      return true;
    }
    issues.push(kitIssue(code, key, { key, kept: held, dropped: partId }));
    return false;
  };

  for (const part of parts) {
    for (const [relative, content] of Object.entries(part.files)) {
      const path = `${part.root.slice(1)}/${relative}`;
      if (claim('path-conflict', path, part.id)) files[path] = content;
    }
    for (const [id, service] of Object.entries(part.manifest.services ?? {})) {
      if (claim('service-conflict', id, part.id)) services[id] = { ...service };
    }
    for (const [id, resource] of Object.entries(part.manifest.resources ?? {})) {
      if (claim('resource-conflict', id, part.id)) resources[id] = { ...resource };
    }
  }

  for (const part of parts) {
    for (const [id, attachment] of Object.entries(part.attach ?? {})) {
      const service = services[id];
      if (!service) {
        issues.push(kitIssue('unknown-service', id, { part: part.id, service: id }));
        continue;
      }
      if (attachment.uses?.length) service.uses = [...new Set([...(service.uses ?? []), ...attachment.uses])];
    }
    const missing = (part.requires ?? []).filter((kind) => !parts.some((other) => other.kind === kind));
    for (const kind of missing) {
      issues.push(kitIssue('missing-requirement', part.id, { part: part.id, kind }));
    }
  }

  // The frontend starts after the backend it calls.
  const frontend = parts.find((part) => part.kind === 'frontend');
  const backend = parts.find((part) => part.kind === 'backend');
  const web = frontend && services[frontend.serviceId];
  if (web && backend && services[backend.serviceId]) web.dependsOn = [...new Set([...(web.dependsOn ?? []), backend.serviceId])];

  // Longest path first, so `/api` wins over `/`.
  const routes: ManifestRoute[] = parts
    .filter((part) => part.ingress !== undefined && services[part.serviceId])
    .map((part) => ({ path: part.ingress!, service: part.serviceId }))
    .sort((a, b) => b.path.length - a.path.length);

  const manifest: KitManifest = {
    $schema: MANIFEST_SCHEMA_URL,
    version: 1,
    name,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    services,
    ingress: { routes },
    environments: kitEnvironments(),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const [path, content] of [[KIT_README_FILE, kitReadme(name, parts)], [MANIFEST_FILE, manifestText]] as const) {
    if (claim('path-conflict', path, 'kit')) files[path] = content;
  }
  return { files, manifest, manifestText, issues };
}

/** `composeKit('react-node', ['postgres'])` → the kit's files, its manifest and any issues. */
export function composeKit(kitId: string, extras: string[] = []): ComposedKit {
  const { kit, issues } = resolveKit(kitId, extras);
  // Nothing to write for a kit that does not exist; the manifest stays the empty v1 shape.
  if (!kit) return { ...composeParts(kitId, []), files: {}, issues };
  const parts = [kit.frontend, kit.backend, ...kit.extras].flatMap((id) => (id ? [KIT_PARTS[id]!] : []));
  const composed = composeParts(kit.id, parts);
  return { ...composed, issues: [...issues, ...composed.issues] };
}
