/**
 * W2: builderforce.json Detector
 *
 * Reads the repo-root `builderforce.json` — a partial AppBlueprint the repo owner writes
 * to correct detection (e.g. `{ "services": [...] }`, `{ "database": {...} }`). It detects
 * nothing itself: the parsed object becomes `overrides`, which `applyOverrides` lays over
 * the detected fields once every detector has run. Invalid JSON (or anything that is not
 * a JSON object) is ignored rather than failing detection.
 */

import type { AppBlueprint, BlueprintDetector } from '@builderforce/creation-canvas-contract';

function parseOverrides(content: string): Partial<AppBlueprint> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<AppBlueprint>;
  } catch {
    return null;
  }
}

export const builderforceJsonDetector: BlueprintDetector = {
  id: 'builderforce-json',
  name: 'builderforce.json Overrides',
  reads: ['builderforce.json'],
  detect: (files: Map<string, string>): Partial<AppBlueprint> => {
    const content = files.get('builderforce.json');
    const overrides = content === undefined ? null : parseOverrides(content);
    // `runDetectors` spreads each detector's `sources` over the running flags, so a
    // detector reports only its own flag — the cast names that registry contract.
    const sources = { builderforceJson: overrides !== null } as AppBlueprint['sources'];
    return overrides ? { sources, overrides } : { sources };
  },
};
