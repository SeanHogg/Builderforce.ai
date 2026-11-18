/**
 * Whether the browser runtime can run a blueprint — decided by the runtime's OWN
 * accept checks (`acceptsNodeService`, `acceptsPgliteService`, `validateSpec`) and its
 * own decline wording (`NODE_DECLINED_COMMANDS`), never a second list of what the
 * browser can run. Runtimes are a table, not branches: a new browser runtime (Python,
 * PHP…) is one entry.
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import {
  acceptsNodeService,
  acceptsPgliteService,
  describeIssue,
  NODE_DECLINED_COMMANDS,
  validateSpec,
  type Acceptance as ServiceAcceptance,
  type ApplicationSpec,
  type ServiceSpec,
} from '@seanhogg/builderforce-webcontainers/app';
import { acceptanceProbe, blueprintToApplicationSpec } from './blueprintToApplicationSpec';
import type { Acceptance } from './runTarget';

/** The browser's runtime providers' accept checks, by `ServiceSpec.runtime`. */
export const BROWSER_RUNTIMES: Readonly<Record<string, (service: ServiceSpec) => ServiceAcceptance>> = {
  node: acceptsNodeService,
  pglite: acceptsPgliteService,
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

/** The spec to run, or the first reason the browser cannot run it. */
export function acceptBlueprintInBrowser(blueprint: AppBlueprint | null): BrowserAcceptance {
  if (!blueprint || blueprint.services.length === 0) return { ok: false, code: 'noBlueprint' };
  const spec = blueprintToApplicationSpec(blueprint);
  for (const service of spec.services) {
    const accepts = BROWSER_RUNTIMES[service.runtime];
    const code = service.type === 'database' ? 'databaseDeclined' : 'serviceDeclined';
    if (!accepts) return { ok: false, code, detail: noProvider(service) };
    const verdict = accepts(acceptanceProbe(service));
    if (!verdict.ok) return { ok: false, code, detail: verdict.reason };
  }
  const issues = validateSpec(spec);
  if (issues.length > 0) return { ok: false, code: 'invalidSpec', detail: describeIssue(issues[0]!) };
  return { ok: true, spec };
}
