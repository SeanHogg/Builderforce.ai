/**
 * THE ONE place a creative editor turns a colour ROLE into a concrete colour.
 *
 * An exported file (a DXF layer, a PDF page, a GIF, a comic page, a model's material)
 * opens in someone else's viewer, where no theme token resolves — so a `var(--x)` cannot
 * be written into it. But a hex literal in editor code is the defect the design-scale
 * guard exists to stop. This resolves the gap: each role names a CSS custom property
 * declared once in `app/globals.css` (`--export-*`, the same in both themes because paper
 * does not go dark), and the property is READ at export time.
 *
 * The pure encoders (comic PDF, GIF palette, DXF/PDF/SVG writers) never call this; they
 * take the resolved colours as parameters, so under node they are given explicit ones.
 */

export const EXPORT_COLOR_ROLES = {
  /** Drawing / comic paper. */
  paper: '--export-paper',
  /** Default drafting and lettering ink. */
  ink: '--export-ink',
  /** A CAD layer's colour until the person picks one. */
  layerInk: '--export-layer-ink',
  /** The drawing sheet's grid lines. */
  gridLine: '--export-grid-line',
  /** A comic caption box. */
  caption: '--export-caption',
  /** A comic panel with no image in it. */
  panelEmpty: '--export-panel-empty',
  /** The animation brush before one is chosen. */
  defaultBrush: '--export-default-brush',
  /** The swatch a colour input shows while the pen is a theme variable (it cannot display one). */
  penFallback: '--export-pen-fallback',
  /** A 3D model's default material. */
  material: '--export-material',
} as const;

export type ExportColorRole = keyof typeof EXPORT_COLOR_ROLES;
export type ExportPalette = Record<ExportColorRole, string>;

/** What a role reads as where there is no document to read it from (server render, node). */
const UNRESOLVED = 'currentcolor';

/**
 * A role, or a `var(--token)` a board pen may hold, as a colour a canvas and a file can
 * use. Anything else is already concrete and passes through.
 */
export function resolveExportColor(value: ExportColorRole | string): string {
  const token = value in EXPORT_COLOR_ROLES ? EXPORT_COLOR_ROLES[value as ExportColorRole] : /^var\(\s*(--[\w-]+)/.exec(value)?.[1];
  if (!token) return value;
  if (typeof document === 'undefined') return UNRESOLVED;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || UNRESOLVED;
}

export function resolveExportPalette(): ExportPalette {
  return Object.fromEntries((Object.keys(EXPORT_COLOR_ROLES) as ExportColorRole[]).map((role) => [role, resolveExportColor(role)])) as ExportPalette;
}
