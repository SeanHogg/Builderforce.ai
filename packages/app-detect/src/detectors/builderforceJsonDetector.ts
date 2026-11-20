/**
 * W2 / W11: builderforce.json Detector
 *
 * Reads the repo-root `builderforce.json`. It detects nothing itself: what the file says
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
import { MANIFEST_FILE_NAME, type ManifestInput } from '../manifest/manifestShape';
import { detectionNote, errorText, noteFrom, warningFindings, type DetectionNote } from '../notes';
import type { AppDetector, DetectorFindings } from '../types';

type Read = { overrides: Partial<AppBlueprint>; warnings: DetectionNote[] } | { warning: DetectionNote };

function readBuilderforceJson(content: string): Read {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { warning: detectionNote('manifest-invalid-json', { file: MANIFEST_FILE_NAME, error: errorText(error) }) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { warning: detectionNote('manifest-not-object', { file: MANIFEST_FILE_NAME }) };
  }
  const version = (parsed as { version?: unknown }).version;
  if (version === undefined) return { overrides: parsed as Partial<AppBlueprint>, warnings: [] };
  if (version !== 1) return { warning: detectionNote('manifest-unsupported-version', { file: MANIFEST_FILE_NAME, version: String(JSON.stringify(version)) }) };
  const mapped = manifestToBlueprintOverrides(parsed as ManifestInput);
  return { overrides: mapped.overrides, warnings: mapped.notes.map((note) => noteFrom(MANIFEST_FILE_NAME, note)) };
}

export const builderforceJsonDetector: AppDetector = {
  id: 'builderforce-json',
  name: 'builderforce.json Overrides',
  reads: [MANIFEST_FILE_NAME],
  detect: (files: Map<string, string>): DetectorFindings => {
    const content = files.get(MANIFEST_FILE_NAME);
    const read = content === undefined ? null : readBuilderforceJson(content);
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
