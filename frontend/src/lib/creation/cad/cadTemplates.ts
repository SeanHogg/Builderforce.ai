import { resolveExportColor } from '../exportColors';
import { createBlankCadState, type CadGrid, type CadState, type CadUnit } from './cadState';

/**
 * Sheet presets per CAD template: paper size, unit and grid, in ONE place so the seed
 * and any card that previews the template read the same dimensions.
 *
 * Sheets follow ISO 216 (A0–A4), which architectural and mechanical drafters both use.
 * Grid spacing matches the usual scale of work: 5 mm for a part, 100 mm for a floor
 * plan, 250 mm for a blueprint, and 2.54 mm — the 0.1-inch pitch ICs are laid out on —
 * for an electrical schematic.
 */
interface CadTemplatePreset {
  widthMm: number;
  heightMm: number;
  unit: CadUnit;
  grid: Pick<CadGrid, 'visibleSpacingMm' | 'snapSpacingMm'>;
}

const PRESETS: Readonly<Record<string, CadTemplatePreset>> = {
  // A2 landscape, 1:50.
  'cad-floor-plan': { widthMm: 594, heightMm: 420, unit: 'mm', grid: { visibleSpacingMm: 100, snapSpacingMm: 10 } },
  // A3 landscape, 1:1 — the drawing IS the part.
  'cad-part-drawing': { widthMm: 420, heightMm: 297, unit: 'mm', grid: { visibleSpacingMm: 5, snapSpacingMm: 1 } },
  'cad-electrical-schematic': { widthMm: 420, heightMm: 297, unit: 'mm', grid: { visibleSpacingMm: 2.54, snapSpacingMm: 2.54 } },
  // A1 landscape, 1:100.
  'cad-blueprint': { widthMm: 841, heightMm: 594, unit: 'mm', grid: { visibleSpacingMm: 250, snapSpacingMm: 50 } },
};

export function cadTemplatePreset(templateId: unknown): CadTemplatePreset | null {
  return typeof templateId === 'string' ? PRESETS[templateId] ?? null : null;
}

/** A blank sheet for a template. An id with no preset gets the default A3 sheet, so a template added to the catalogue before its preset still opens. */
export function seedCadFromTemplate(templateId: unknown, layerInk: string = resolveExportColor('layerInk')): CadState {
  const preset = cadTemplatePreset(templateId);
  return preset ? createBlankCadState({ layerInk, widthMm: preset.widthMm, heightMm: preset.heightMm, unit: preset.unit, grid: preset.grid }) : createBlankCadState({ layerInk });
}
