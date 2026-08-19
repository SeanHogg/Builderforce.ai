/**
 * THE settings-manifest primitive — one declaration per non-spec canvas kind, read by
 * both the anchored panel and the full inspector.
 *
 * ── WHY THIS IS NOT `specObjects.ts` ─────────────────────────────────────────────
 * `specObjects.ts` proved the mechanism for CARD BODY content: declare a kind's fields
 * once and let one renderer draw every kind that registers. This module is the same
 * mechanism applied to a different surface — the settings/inspector panels — and it is
 * a SEPARATE closed vocabulary on purpose. `SpecField.render` answers "how does this
 * value look on the card" (stat, chips, matrix, bars…); a settings field answers "how
 * does a person EDIT this, and does this button even apply to them" (text input, a
 * schedule, a Sell-in-marketplace action that must not appear on a managed seat).
 * Folding those into one union is how a display style and an input control end up
 * disagreeing about what a kind means, which is the exact drift the spec-object
 * module's own header records for the mechanism it replaced.
 *
 * ── WHY `custom.component` EXISTS ────────────────────────────────────────────────
 * Not every kind is a form. `dataset` imports a file and profiles it; `website` edits a
 * live hero and theme; `build` opens a whole workspace. Those already live in their own
 * well-factored components (`BuildInspectorSection`, `CanvasVoiceInspector`,
 * `PitchInspector`, …). A manifest entry for a kind like that does not re-declare its
 * fields — it names the component, so the ONE thing that changes is how the inspector
 * DISPATCHES to it (a lookup, not a 700-line `kind === 'x'` chain), never what the
 * component does internally.
 *
 * ── ORIGIN, GENERALIZED ──────────────────────────────────────────────────────────
 * `canvasPersonOrigin` in `canvasNodeAffordances.ts` already answers "did this agent
 * come from the role catalog or get written here" for the two kinds that needed it.
 * `marketplace.sellable` and a field's `editable` read `data` directly and call into
 * that (or default to always-custom) rather than this module inventing a second origin
 * concept — a managed seat's card is still what decides whether it is managed.
 */

import type { CreationNodeData } from '@/components/creation-canvas/types';

export type SettingsControl =
  | 'text' | 'textarea' | 'select' | 'number' | 'switch' | 'color' | 'file' | 'checkbox' | 'chips';

export interface SettingsFieldOption {
  value: string;
  /** i18n key under the surface's namespace — used for every option except a literal
   *  brand/proper noun (a runtime's own name), which is never translated copy. */
  labelKey?: string;
  /** A literal label, for the option that IS a name rather than a translated phrase. */
  label?: string;
}

export interface SettingsField {
  name: string;
  control: SettingsControl;
  /** Where in a panel this field sits. `identity` and `basic` are always visible;
   *  `advanced` is behind the Advanced switch on both surfaces. */
  section: 'identity' | 'basic' | 'advanced';
  /** i18n key under `creationCanvas.nodePanel` (compact) / `creationCanvas` (full). */
  labelKey: string;
  hint?: string;
  options?: readonly SettingsFieldOption[];
  min?: number;
  max?: number;
  /** Key into `CreationCanvas.module.css`'s `styles` object for a `select` needing its
   *  own opaque, per-theme-legible `<option>` styling (a diagram's notation list) — a
   *  literal class string would not survive the module's hashing, so this names the
   *  key and the renderer resolves it. Absent means the plain control. */
  selectClassName?: string;
  /**
   * `compact` = anchored panel only, `full` = inspector only, `both` = everywhere.
   * A rich field (a textarea of instructions, a tool-pill editor) is usually `full`;
   * the handful of fields worth editing without leaving the board are `both`.
   */
  surface: 'compact' | 'full' | 'both';
  editable?: (data: CreationNodeData) => boolean;
  visible?: (data: CreationNodeData) => boolean;
  /** i18n key (under `creationCanvas`) for the control's placeholder, when it has one. */
  placeholderKey?: string;
  /** i18n key (under `creationCanvas`) for a value shown when the field is unset — a
   *  frame's purpose reading "Arrange objects here" until somebody names it, rather
   *  than an empty box. Distinct from a placeholder: this is what a fresh object
   *  actually carries into `onChange`'s patch the moment it is edited at all. */
  fallbackKey?: string;
  /** A second field to read when this one is unset — a file's name falling back to the
   *  object's own title. Checked after `fallbackKey`. */
  fallbackField?: string;
  /** For `color`: the swatch a fresh object shows before anyone has picked one — see
   *  `authoredColors.ts` for why these are literal hex, never a theme token. */
  defaultColor?: string;
  /**
   * The patch a new value writes, when it is not simply `{ [name]: value }`. Exists for
   * the handful of fields that mirror one authored value into a second field a reader
   * (Brain, an export) already expects — a document's `markdown` into `content` — so
   * that mirroring is declared once beside the field rather than reinvented at each call
   * site the way `onWebsiteChange`/creative-brief writers each did.
   */
  toPatch?: (value: unknown) => Record<string, unknown>;
}

export interface SettingsAction {
  name: string;
  /** i18n key under `creationCanvas`. */
  labelKey: string;
  style: 'primary' | 'secondary';
  /** Key into the inspector's local handler map — see `KindDetailsInspector`. Kept a
   *  string (not a function reference) so the MANIFEST stays data: which actions exist,
   *  in which order, and when they apply is declared here, while the actual side-
   *  effecting function stays where it always lived, in `CreationCanvas`'s closure. */
  handler: string;
  visible?: (data: CreationNodeData) => boolean;
  disabled?: (data: CreationNodeData) => boolean;
}

export interface KindSettingsManifest {
  kinds: readonly string[];
  /** Whether THIS INSTANCE may be sold in the marketplace — instance-level, not just
   *  kind-level, which is the fix for a managed seat showing a custom agent's buttons. */
  marketplace: { sellable: (data: CreationNodeData) => boolean };
  fields: readonly SettingsField[];
  actions: readonly SettingsAction[];
  /** i18n key (under `creationCanvas`) for a single explanatory paragraph, drawn once
   *  after the fields on the full surface — the many one-line hints ("only fetched
   *  columns can be plotted", "this view stays on this board") that do not belong to
   *  any one field. */
  hintKey?: string;
  /** Present when this kind's full-inspector body is a real component rather than a
   *  field list — see the module header. */
  custom?: { component: string };
}

const MANIFESTS: KindSettingsManifest[] = [];
let byKind: Map<string, KindSettingsManifest> | null = null;

/** Register one manifest, covering one or more kinds. Invalidates the index rather than
 *  rebuilding it, so registration order cannot matter — the same guarantee
 *  `registerSpecObjectSet` makes. */
export function registerKindSettings(manifest: KindSettingsManifest): void {
  MANIFESTS.push(manifest);
  byKind = null;
}

function index(): Map<string, KindSettingsManifest> {
  if (byKind) return byKind;
  const next = new Map<string, KindSettingsManifest>();
  for (const manifest of MANIFESTS) for (const kind of manifest.kinds) next.set(kind, manifest);
  byKind = next;
  return next;
}

/** The manifest for one kind, or null when the kind is not settings-driven (either a
 *  spec-object kind, edited on its card, or a kind with no configurable settings). */
export function kindSettingsManifest(kind: string): KindSettingsManifest | null {
  return index().get(kind) ?? null;
}

export function isKindSettingsKind(kind: string): boolean {
  return index().has(kind);
}

/** This kind's fields for one surface, in declaration order, already filtered by
 *  `visible`. */
export function kindSettingsFields(
  kind: string,
  data: CreationNodeData,
  surface: 'compact' | 'full',
): readonly SettingsField[] {
  const manifest = kindSettingsManifest(kind);
  if (!manifest) return [];
  return manifest.fields.filter(
    (field) => (field.surface === surface || field.surface === 'both') && (!field.visible || field.visible(data)),
  );
}

/** This kind's actions, already filtered by `visible`. */
export function kindSettingsActions(kind: string, data: CreationNodeData): readonly SettingsAction[] {
  return (kindSettingsManifest(kind)?.actions ?? []).filter((action) => !action.visible || action.visible(data));
}

/** Whether THIS instance of this kind may be sold in the marketplace. Kinds with no
 *  settings manifest (the spec-object vocabularies) are not gated here at all — their
 *  publish button keeps the kind-only check `SellInMarketplace` already had. */
export function kindSettingsSellable(kind: string, data: CreationNodeData): boolean {
  return kindSettingsManifest(kind)?.marketplace.sellable(data) ?? true;
}

/**
 * Whether this kind has more than the compact panel shows — a custom section, an action
 * button, or a field not already offered on `compact`.
 *
 * What the Advanced "there is more" control reads to decide whether widening the panel
 * would actually reveal anything: a kind with no manifest at all (every spec-object kind)
 * always does, since that hint predates this registry and nothing here narrows it.
 */
export function kindSettingsHasMoreThanCompact(kind: string): boolean {
  const manifest = kindSettingsManifest(kind);
  if (!manifest) return true;
  return !!manifest.custom || manifest.actions.length > 0 || manifest.fields.some((field) => field.surface !== 'compact');
}

/** Every registered manifest, for the completeness guard. */
export function allKindSettingsManifests(): readonly KindSettingsManifest[] {
  return MANIFESTS;
}
