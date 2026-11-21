/**
 * W2 / W11: builderforce.json Detector
 *
 * Reads the project's manifest: `.builderforce/builderforce.json`, else a root
 * `builderforce.json` / `bfwc.app.json` an older version left (`MANIFEST_READ_PATHS`, canonical
 * first; the first one present is the manifest). It detects nothing itself: what the file says
 * becomes `overrides`, which `applyOverrides` lays over the detected fields once every
 * detector has run. Two formats (PRD 31 §W11 Rev 2 item 8 — readers stay compatible):
 *
 * - `"version": 1` — the app manifest v1. Its services, database and variables are mapped
 *   to blueprint fields by `manifestToBlueprintOverrides`; what that cannot map is a warning.
 * - no `version` — the legacy format, a partial `AppBlueprint`, read as-is.
 *
 * A file that cannot be used — invalid JSON, not a JSON object, another `version` — is
 * REPORTED as a detection warning naming the problem, never dropped silently, and sets no
 * overrides.
 */

import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { manifestToBlueprintOverrides } from '../manifest/manifestToBlueprintOverrides';
import { MANIFEST_READ_PATHS, type ManifestInput } from '../manifest/manifestShape';
import { detectionNote, errorText, noteFrom, warningFindings, type DetectionNote } from '../notes';
import type { AppDetector, DetectorFindings } from '../types';

type Read = { overrides: Partial<AppBlueprint>; warnings: DetectionNote[] } | { warning: DetectionNote };

/** `file`: the project-relative path the content came from, named in every note. */
function readBuilderforceJson(file: string, content: string): Read {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { warning: detectionNote('manifest-invalid-json', { file, error: errorText(error) }) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { warning: detectionNote('manifest-not-object', { file }) };
  }
  const version = (parsed as { version?: unknown }).version;
  if (version === undefined) return { overrides: parsed as Partial<AppBlueprint>, warnings: [] };
  if (version !== 1) return { warning: detectionNote('manifest-unsupported-version', { file, version: String(JSON.stringify(version)) }) };
  const mapped = manifestToBlueprintOverrides(parsed as ManifestInput);
  return { overrides: mapped.overrides, warnings: mapped.notes.map((note) => noteFrom(file, note)) };
}

export const builderforceJsonDetector: AppDetector = {
  id: 'builderforce-json',
  name: 'builderforce.json Overrides',
  reads: [...MANIFEST_READ_PATHS],
  detect: (files: Map<string, string>): DetectorFindings => {
    const file = MANIFEST_READ_PATHS.find((candidate) => files.has(candidate));
    const read = file === undefined ? null : readBuilderforceJson(file, files.get(file)!);
    const overrides = read && 'overrides' in read ? read.overrides : null;
    // `runDetectors` spreads each detector's `sources` over the running flags, so a
    // detector reports only its own flag — the cast names that registry contract.
    const sources = { builderforceJson: overrides !== null } as AppBlueprint['sources'];
    const warnings = !read ? [] : 'warning' in read ? [read.warning] : read.warnings;
    return {
      sources,
      ...(overrides ? { overrides } : {}),
      ...warningFindings(warnings),
    };
  },
};
