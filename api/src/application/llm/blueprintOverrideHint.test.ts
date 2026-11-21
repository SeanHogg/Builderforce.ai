/**
 * The override the blueprint tools tell an agent to write is a manifest the runtime reads as
 * one: an app manifest v1 at `.builderforce/builderforce.json`, parsed and validated with zero
 * issues by the runtime's own reader — never the unversioned legacy format.
 */
import { describe, expect, it } from 'vitest';
import { parseManifest, validateManifest } from '@seanhogg/builderforce-webcontainers/app';
import { detectApp } from '@builderforce/app-detect';
import { OVERRIDE_EXAMPLE, OVERRIDE_HINT } from './blueprintOverrideHint';

describe('the blueprint override hint', () => {
  it('names .builderforce/builderforce.json and quotes its example', () => {
    expect(OVERRIDE_HINT).toContain('.builderforce/builderforce.json');
    expect(OVERRIDE_HINT).toContain(JSON.stringify(OVERRIDE_EXAMPLE));
  });

  it('recommends a v1 manifest the runtime reads with zero issues', () => {
    const parsed = parseManifest(JSON.stringify(OVERRIDE_EXAMPLE));
    expect(parsed.manifest).not.toBeNull();
    expect([...parsed.issues, ...validateManifest(parsed.manifest!)]).toEqual([]);
  });

  it('is laid over detection from .builderforce/builderforce.json', () => {
    const detection = detectApp(new Map([['.builderforce/builderforce.json', JSON.stringify(OVERRIDE_EXAMPLE)]]));
    expect(detection.blueprint.sources.builderforceJson).toBe(true);
    expect(detection.blueprint.services.map((service) => service.id)).toEqual(['api']);
    expect(detection.blueprint.database?.engine).toBe('postgres');
  });
});
