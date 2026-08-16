/**
 * The DEFAULT template catalogue — the scenarios every workspace can start from
 * on day one, before anyone authors or installs anything.
 *
 * Shipped as CODE, for the same reason the connector catalogue is: a seeded
 * catalogue forks per tenant the moment it is written, so correcting a wrong
 * action key or adding a step would mean a data migration across every
 * workspace, and workspaces created before the fix would keep the broken copy
 * forever. As code, every workspace reads the same current manifest and a fix
 * ships with the deploy.
 *
 * Each manifest is run through `parseTemplateManifest` HERE, at module load, so
 * a built-in is validated by exactly the validator an untrusted published
 * template gets. A built-in with a binding no step collects, or a workflow graph
 * with a dangling edge, must not be the thing a customer discovers — it must be
 * the thing the catalogue's own guard test discovers.
 */

import {
  parseTemplateManifest,
  withDerivedConnectSteps,
  type TemplateManifest,
} from '../../../domain/template/templateManifest';
import { BUSINESS_TEMPLATES } from './business';
import { MARKETING_TEMPLATES } from './marketing';
import { MESSAGING_TEMPLATES } from './messaging';
import type { BuiltinTemplate } from './dsl';

/** Every built-in, before validation. Declaration order is catalogue order. */
export const BUILTIN_TEMPLATE_SOURCES: readonly BuiltinTemplate[] = [
  ...MARKETING_TEMPLATES,
  ...MESSAGING_TEMPLATES,
  ...BUSINESS_TEMPLATES,
];

/**
 * Normalise one authored template: fill the optional fields, derive the connect
 * steps its required connectors imply, and validate the result.
 *
 * Exported so `defaults.test` can assert the whole catalogue survives it and
 * report WHICH template failed and why, rather than the suite dying on an import
 * with a stack trace nobody can map back to a file.
 */
export function normalizeBuiltinTemplate(source: BuiltinTemplate): TemplateManifest {
  return withDerivedConnectSteps(parseTemplateManifest({
    tags: [],
    successCriteria: [],
    requiredSecrets: [],
    ...source,
  }));
}

const ALL: readonly TemplateManifest[] = BUILTIN_TEMPLATE_SOURCES.map(normalizeBuiltinTemplate);

/** Built-in manifests, keyed for O(1) resolution. */
export const BUILTIN_TEMPLATES: ReadonlyMap<string, TemplateManifest> = new Map(ALL.map((t) => [t.key, t]));

/** The built-in catalogue as a list, in declaration order. */
export const BUILTIN_TEMPLATE_LIST: readonly TemplateManifest[] = ALL;

/** Keys a workspace may NOT reuse when saving a template of its own. */
export const RESERVED_TEMPLATE_KEYS: ReadonlySet<string> = new Set(ALL.map((t) => t.key));

/** True when `key` names a built-in and therefore cannot be claimed by anyone
 *  else. Lives with its data, so both the authoring path and the publish-review
 *  path can ask without either importing the registry. */
export function isReservedTemplateKey(key: string): boolean {
  return RESERVED_TEMPLATE_KEYS.has(key);
}
