/**
 * IDE starter templates — the ONE source, for every runtime that touches them.
 *
 * Three runtimes need the same answers about the same scaffolds:
 *
 *  · the API Worker SEEDS them into R2 at project creation and self-heals a
 *    missing/empty file on file-list (`api/src/application/project/projectTemplate.ts`);
 *  · the legacy worker's file router seeds them for its own create path
 *    (`worker/src/routes/projects.ts`);
 *  · the Next app MOUNTS them in the WebContainer as the Run fallback, and uses
 *    the same path set to avoid posting a zero-byte write the API would refuse
 *    (`frontend/src/components/BuilderWorkspace.tsx`, `lib/scaffoldRepair.ts`).
 *
 * They used to be two byte-identical copies pinned by a parity test, and they
 * drifted anyway: `webmobile` reached the frontend's modality map and never the
 * API's, so every "Web + Mobile" project was created with no files at all. A
 * test can only report that divergence after someone writes it. This package
 * makes it unrepresentable — the map below is the only place a modality is
 * mapped to a scaffold, so a new modality is one edit or it is nothing.
 *
 * Source-only, zero runtime deps: consumers alias the bare specifier straight at
 * this file (tsconfig `paths` for tsc/wrangler/next-on-pages, `resolve.alias` for
 * vitest), exactly as `@builderforce/creation-canvas-contract` already does
 * across the same Worker/Next split.
 */
export { VANILLA_TEMPLATE, MOBILE_TEMPLATE } from './scaffolds';

import { VANILLA_TEMPLATE, MOBILE_TEMPLATE } from './scaffolds';

/** Every starter template, keyed by the `template` value that selects it. */
export const TEMPLATES: Record<string, Record<string, string>> = {
  vanilla: VANILLA_TEMPLATE,
  mobile: MOBILE_TEMPLATE,
};

/**
 * Modalities that run code in the WebContainer, mapped to their starter.
 *
 * `webmobile` (Web + Mobile) ships ONE react-native-web codebase that renders
 * full-width as a site and inside the phone simulator, so it takes the mobile
 * scaffold. The generative modalities (video/evermind/finetune/voice) are absent
 * on purpose: they never run the Vite app, so they get no scaffold.
 */
export const TEMPLATE_BY_MODALITY: Record<string, string> = {
  designer: 'vanilla',
  mobile: 'mobile',
  webmobile: 'mobile',
};

/** The explicitly-named template, if it is one we still ship. */
export function templateByName(name: string | null | undefined): Record<string, string> | undefined {
  return name ? TEMPLATES[name] : undefined;
}

/**
 * The scaffold a MODALITY runs, or null when that modality never runs code.
 *
 * A null/absent modality is treated as `designer` — the default a project gets
 * before anyone picks one, and the one an older create path may have left blank.
 */
export function scaffoldForModality(modality: string | null | undefined): Record<string, string> | null {
  const key = TEMPLATE_BY_MODALITY[modality ?? 'designer'];
  return (key && TEMPLATES[key]) || null;
}

/** Every path owned by ANY starter scaffold, across modalities. */
export const SCAFFOLD_PATHS: ReadonlySet<string> = new Set(
  Object.values(TEMPLATES).flatMap((template) => Object.keys(template)),
);

/**
 * Is this workspace-relative path a file a starter scaffold owns?
 *
 * A scaffold file may be edited or deleted, but never *emptied*: a 0-byte
 * `package.json` / `index.html` / `vite.config.js` is never a state a user or an
 * agent means to reach, and it only ever breaks Run. A Mobile project was once
 * observed with all five scaffold paths present in R2 at size 0 and the writer
 * was never identified, so the invariant is enforced where every writer must
 * pass — the API's write chokepoint (`workspaceStore.validateScaffoldNotEmptied`)
 * refuses such a write, and the client consults the same set so file-create
 * seeds the template instead of posting the empty body it would otherwise send.
 */
export function isScaffoldPath(path: string): boolean {
  return SCAFFOLD_PATHS.has(path);
}
