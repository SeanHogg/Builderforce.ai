/**
 * `builderforce.json` is the one designed way to correct detection, so these pin the
 * whole path: the detector turns the file into `overrides`, and `applyOverrides`
 * REPLACES detected fields with them — never concatenates, never touches provenance.
 */

import { describe, expect, it } from 'vitest';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { applyOverrides } from './blueprintOverrides';
import { builderforceJsonDetector } from './detectors/builderforceJsonDetector';
import { runDetectors } from './detectors';

function detected(): AppBlueprint {
  return {
    id: '1-abc',
    projectId: 1,
    commitSha: 'abc',
    detectedAt: new Date(0),
    services: [],
    bindings: [],
    database: { engine: 'neon', migrationCommand: 'm', seedCommand: null, migrationsPath: 'drizzle', connectionSecretName: 'DATABASE_URL' },
    secrets: [{ name: 'A', required: true }],
    vars: [],
    domains: [],
    sources: {
      wranglerToml: false, packageJson: false, viteConfig: false, nextConfig: false,
      expoConfig: false, capacitorConfig: false, drizzleConfig: false, prismaSchema: false,
      dockerfile: false, envExample: false, githubWorkflows: false, builderforceJson: false,
    },
    overrides: null,
    isMonorepo: false,
    workspaces: [],
  };
}

describe('builderforceJsonDetector', () => {
  it('turns a valid builderforce.json into overrides', () => {
    const result = builderforceJsonDetector.detect(new Map([['builderforce.json', '{"isMonorepo":true}']]));
    expect(result.sources?.builderforceJson).toBe(true);
    expect(result.overrides).toEqual({ isMonorepo: true });
  });

  it('ignores invalid JSON and non-object JSON', () => {
    for (const content of ['{nope', '[1,2]', 'null']) {
      const result = builderforceJsonDetector.detect(new Map([['builderforce.json', content]]));
      expect(result.sources?.builderforceJson).toBe(false);
      expect(result.overrides).toBeUndefined();
    }
  });

  it('reports only its own source flag through the registry', () => {
    const result = runDetectors(new Map([['builderforce.json', '{}']]));
    expect(result.sources?.builderforceJson).toBe(true);
    expect(result.sources?.packageJson).toBe(false);
  });
});

describe('applyOverrides', () => {
  it('returns the blueprint unchanged when there are no overrides', () => {
    const bp = detected();
    expect(applyOverrides(bp, null)).toBe(bp);
  });

  it('replaces arrays rather than concatenating, and honours null', () => {
    const result = applyOverrides(detected(), { secrets: [{ name: 'B', required: false }], database: null });
    expect(result.secrets).toEqual([{ name: 'B', required: false }]);
    expect(result.database).toBeNull();
  });

  it('never overrides identity or provenance', () => {
    const result = applyOverrides(detected(), { id: 'x', projectId: 9, commitSha: 'zzz', overrides: {} });
    expect(result.id).toBe('1-abc');
    expect(result.projectId).toBe(1);
    expect(result.commitSha).toBe('abc');
    expect(result.overrides).toBeNull();
  });
});
