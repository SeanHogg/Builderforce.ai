/**
 * Starter-kit parts (PRD 31 §W11 phase 3) — the vocabulary, and nothing else.
 *
 * A kit is composed from PARTS (one frontend, at most one backend, any extras), so
 * N frontends + M backends cover N × M kits. A part is data: the files it writes under
 * its service root, and its fragment of the `builderforce.json` v1 manifest. The v1
 * entry shapes a kit writes (services, resources, ingress routes) are app-detect's — ONE
 * owner, `@builderforce/app-detect/manifest`, which `emitManifest` writes through too —
 * the whole document and its environments included (`KitManifest` only narrows it).
 */
import type { EmittedManifest, EmittedResource, EmittedService } from '@builderforce/app-detect/manifest';

export type KitPartKind = 'frontend' | 'backend' | 'extra';

/** The service a part's files and fragment belong to. */
export type KitServiceId = 'web' | 'api';

/** Where that service's files live, from the project root. */
export type KitRoot = '/web' | '/api';

/** The part of the manifest one part contributes. Entries are keyed by id, so two parts naming one id is a conflict. */
export interface ManifestFragment {
  services?: Record<string, EmittedService>;
  resources?: Record<string, EmittedResource>;
}

/** What an extra adds to a service another part declares (the postgres extra: `uses: ['db']` on the backend). */
export interface ServiceAttachment {
  uses?: string[];
}

export interface KitPart {
  id: string;
  kind: KitPartKind;
  /** English label; the starter-kit command lists it (the user's app is not localized; hosts label the UI around it). */
  label: string;
  /** Other names a kit id may use for this part (`react` → `react-vite`). */
  aliases?: readonly string[];
  serviceId: KitServiceId;
  root: KitRoot;
  /** The ingress path routed to this part's service (`/` for a frontend, `BACKEND_INGRESS_PATH` for a backend). */
  ingress?: string;
  /** File contents keyed by path RELATIVE to `root`. */
  files: Readonly<Record<string, string>>;
  manifest: ManifestFragment;
  /** Additions to services declared by other parts, keyed by service id. */
  attach?: Readonly<Record<string, ServiceAttachment>>;
  /** Part kinds the kit must also hold for this part to work (an extra needs a backend). */
  requires?: readonly KitPartKind[];
}

/** A kit id resolved to its parts' canonical ids. */
export interface KitDefinition {
  /** Canonical id: `<frontend>-<backend>`, or the frontend alone. */
  id: string;
  frontend: string;
  backend?: string;
  extras: string[];
}

/** The `builderforce.json` v1 document a kit ships: app-detect's one document shape, always named and always routed. */
export type KitManifest = EmittedManifest & Required<Pick<EmittedManifest, 'name' | 'ingress'>>;

/** A conflict: two parts claim one key; the first part's entry is kept. */
interface KitConflictParams {
  key: string;
  /** The part whose entry was kept. */
  kept: string;
  /** The part whose entry was dropped. */
  dropped: string;
}

/**
 * What each issue code says, as data: hosts word the issue in the person's language from
 * `code` + `params` (the VS Code extension through `vscode.l10n`); `message` is the
 * English default for hosts that do not localize.
 */
export interface KitIssueParams {
  'unknown-kit': { kit: string; namedKits: readonly string[]; frontends: readonly string[]; backends: readonly string[] };
  'unknown-extra': { extra: string; extras: readonly string[] };
  'missing-requirement': { part: string; kind: KitPartKind };
  'path-conflict': KitConflictParams;
  'service-conflict': KitConflictParams;
  'resource-conflict': KitConflictParams;
  'unknown-service': { part: string; service: string };
}

export type KitIssueCode = keyof KitIssueParams;

/** One issue: a typed code with its params, and the English sentence for non-localized consumers. */
export type KitIssue = {
  [C in KitIssueCode]: {
    code: C;
    params: KitIssueParams[C];
    /** English; hosts that localize word it from `code` + `params` instead. */
    message: string;
    /** The file path, service id or resource id the issue is about. */
    key?: string;
  };
}[KitIssueCode];

export interface ComposedKit {
  /** File contents keyed by project-relative path (`web/package.json`, `.builderforce/builderforce.json`). */
  files: Record<string, string>;
  manifest: KitManifest;
  manifestText: string;
  issues: KitIssue[];
}
