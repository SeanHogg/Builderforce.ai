/**
 * Whether the browser runtime can run a blueprint — decided by the runtime's OWN
 * accept checks (`acceptsNodeService`, `acceptsPgliteService`, `acceptsPythonService`,
 * `acceptsPhpService`, `validateSpec`) and its own decline wording
 * (`NODE_DECLINED_COMMANDS`), never a second list of what the browser can run.
 * Runtimes are a table, not branches: a new browser runtime is one entry.
 *
 * Some declines need the project's files — Python requirements with native-only
 * packages (`psycopg2`, `torch` …), a composer.json needing what php-wasm lacks
 * (`ext-pgsql`, a PHP version) — so the check takes them when the caller has them
 * (the start does); without them it judges the services alone. PHP is judged against the
 * PHP the preview runtime boots (`PREVIEW_PHP_OPTIONS`), not the package default. A shell
 * line's Python / PHP commands (`pip install … && python app.py`) are judged by their own
 * runtime as well as by the shell's.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import type { VirtualFileSystem } from '@seanhogg/builderforce-webcontainers';
import {
  acceptsNodeService,
  acceptsPgliteService,
  acceptsPhpService,
  acceptsPythonService,
  describeIssue,
  expectedPlatform,
  NODE_DECLINED_COMMANDS,
  validateSpec,
  type Acceptance as ServiceAcceptance,
  type ApplicationSpec,
  type ServiceSpec,
} from '@seanhogg/builderforce-webcontainers/app';
import { PREVIEW_PHP_OPTIONS } from '@/lib/browserRuntime/previewPhpOptions';
import { acceptanceProbe, blueprintToApplicationSpec, shellRuntimeProbes } from './blueprintToApplicationSpec';
import type { Acceptance } from './runTarget';

/** A runtime provider's accept check: the service, and the project's files when known. */
export type BrowserAccepts = (service: ServiceSpec, files?: VirtualFileSystem) => ServiceAcceptance;

/** The PHP the preview runtime runs — derived from the SAME options object it boots with. */
const PREVIEW_PHP_PLATFORM = expectedPlatform({ php: PREVIEW_PHP_OPTIONS });

/** The browser's runtime providers' accept checks, by `ServiceSpec.runtime`. */
export const BROWSER_RUNTIMES: Readonly<Record<string, BrowserAccepts>> = {
  node: acceptsNodeService,
  pglite: acceptsPgliteService,
  python: acceptsPythonService,
  php: (service, files) => acceptsPhpService(service, files, PREVIEW_PHP_PLATFORM),
};

/** Runtimes with no browser provider whose reason the runtime already words, by the command it names. */
const RUNTIME_DECLINED_AS: Readonly<Record<string, string>> = { workerd: 'wrangler', docker: 'docker' };

export type BrowserAcceptance =
  | { ok: true; spec: ApplicationSpec }
  | Exclude<Acceptance, { ok: true }>;

function noProvider(service: ServiceSpec): string {
  const reason = NODE_DECLINED_COMMANDS[RUNTIME_DECLINED_AS[service.runtime] ?? ''];
  return `${service.id}: ${reason ?? service.runtime}`;
}

/** The spec to run, or the first reason the browser cannot run it (judged on `files` too, when given). */
export function acceptBlueprintInBrowser(blueprint: AppBlueprint | null, files?: VirtualFileSystem): BrowserAcceptance {
  if (!blueprint || blueprint.services.length === 0) return { ok: false, code: 'noBlueprint' };
  const spec = blueprintToApplicationSpec(blueprint);
  for (const service of spec.services) {
    const accepts = BROWSER_RUNTIMES[service.runtime];
    const code = service.type === 'database' ? 'databaseDeclined' : 'serviceDeclined';
    if (!accepts) return { ok: false, code, detail: noProvider(service) };
    const verdict = accepts(acceptanceProbe(service), files);
    if (!verdict.ok) return { ok: false, code, detail: verdict.reason };
    // A shell line's Python / PHP commands are judged by their own runtime too (its file checks included).
    for (const probe of shellRuntimeProbes(service)) {
      const shelled = BROWSER_RUNTIMES[probe.runtime]?.(probe, files);
      if (shelled && !shelled.ok) return { ok: false, code, detail: shelled.reason };
    }
  }
  const issues = validateSpec(spec);
  if (issues.length > 0) return { ok: false, code: 'invalidSpec', detail: describeIssue(issues[0]!) };
  return { ok: true, spec };
}
