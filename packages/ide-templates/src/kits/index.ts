/**
 * `@builderforce/ide-templates/kits` — the starter kits (PRD 31 §W11 phase 3): frontend ×
 * backend × extras composed into one app and its `builderforce.json` v1 manifest.
 *
 * A subpath of its own, NOT re-exported from the package root: the parts are ~25 KB of
 * source strings, and the API Worker and the legacy worker import the root only for the
 * IDE scaffolds. Hosts that compose kits (the VS Code extension's `/starter-kit`) import
 * this entry. The `react-vite` part is built on `VANILLA_TEMPLATE` — one copy of those bytes.
 */
export { composeKit, composeParts, resolveKit, KIT_README_FILE } from './compose';
export { KIT_PARTS, NAMED_KITS, findKitPart, listKitOptions, listStarterKits } from './registry';
export type { KitOptions, KitPartOption } from './registry';
export { installStepId, KIT_API_PORT, KIT_WEB_PORT } from './parts/fragments';
export type {
  ComposedKit, KitDefinition, KitIssue, KitIssueCode, KitIssueParams, KitManifest, KitPart, KitPartKind, KitRoot, KitServiceId,
  KitAgentDeclaration, ManifestFragment, ServiceAttachment,
} from './types';
