import { describe, expect, it } from 'vitest';
import {
  CREATIVE_CAPABILITIES,
  creativeOutputFormats,
  creativeOutputProfile,
} from '@builderforce/creation-canvas-contract';

/**
 * The contract may not advertise a format nothing produces.
 *
 * `CREATIVE_CAPABILITIES` is served to the MODEL through `builtinMcpService`, so whatever
 * it lists is what Brain offers a person. Before the profiles carried a `producer` it
 * listed OBJ, STEP and GLB for `model3d` (the route emits ASCII STL) and five audio
 * containers for `podcast` (the generator emits a Markdown script) — a promise that failed
 * in front of the user as a format that never arrived.
 *
 * This is the guard that keeps it honest for the two producers a unit test can actually
 * check: the native generator's own `KINDS` table, and the game targets. The
 * `studioModel` profiles cannot be checked here by construction — the true set depends on
 * the tenant's connected model — which is why they are labelled rather than asserted.
 */

/** `KINDS` in `creativeRoutes.ts`, restated as the assertion rather than imported: the
 *  route builds a Hono router at module load, so importing it drags the whole app in. A
 *  drift here is a two-line failure that names the kind. */
const NATIVE_GENERATOR_OUTPUTS: Record<string, { format: string; extension: string; mimeType: string }> = {
  cad: { format: 'DXF', extension: 'dxf', mimeType: 'application/dxf' },
  model3d: { format: 'STL', extension: 'stl', mimeType: 'model/stl' },
  game: { format: 'HTML', extension: 'html', mimeType: 'text/html' },
  resume: { format: 'Markdown', extension: 'md', mimeType: 'text/markdown' },
  podcast: { format: 'Markdown script', extension: 'md', mimeType: 'text/markdown' },
  template: { format: 'JSON', extension: 'json', mimeType: 'application/json' },
};

describe('the creative capability contract', () => {
  it('gives every advertised format a producer', () => {
    for (const capability of CREATIVE_CAPABILITIES) {
      expect(capability.outputProfiles.length, `${capability.kind} advertises no format at all`).toBeGreaterThan(0);
      for (const profile of capability.outputProfiles) {
        expect(profile.producer, `${capability.kind}/${profile.format}`).toBeTruthy();
        expect(profile.extension, `${capability.kind}/${profile.format}`).toMatch(/^[a-z0-9]+$/);
        expect(profile.mimeType, `${capability.kind}/${profile.format}`).toContain('/');
      }
    }
  });

  it('matches the native generator exactly, kind for kind', () => {
    for (const [kind, expected] of Object.entries(NATIVE_GENERATOR_OUTPUTS)) {
      const native = CREATIVE_CAPABILITIES
        .find((entry) => entry.kind === kind)!
        .outputProfiles.filter((profile) => profile.producer === 'creativeRoutes');
      expect(native, `${kind} should advertise exactly one natively generated format`).toHaveLength(1);
      expect(native[0]).toMatchObject(expected);
    }
  });

  it('no longer advertises the formats the generators never emitted', () => {
    // The three the roadmap named. Each was a format a person could ask Brain for and
    // never receive.
    expect(creativeOutputFormats('model3d')).toEqual(['STL']);
    expect(creativeOutputFormats('podcast')).toEqual(['Markdown script']);
    expect(creativeOutputFormats('cad')).toEqual(['DXF']);
  });

  it('keeps the game targets, which are all real', () => {
    expect(creativeOutputFormats('game')).toEqual(['HTML', 'Web app', 'Android APK', 'iOS app', 'Roblox place']);
    expect(creativeOutputProfile('game', 'Android APK')?.pro).toBe(true);
  });

  it('resolves a format case-insensitively, or not at all', () => {
    expect(creativeOutputProfile('model3d', 'stl')?.extension).toBe('stl');
    expect(creativeOutputProfile('model3d', 'GLB')).toBeNull();
    expect(creativeOutputProfile('nonsense', 'STL')).toBeNull();
  });

  it('never names a publish destination twice for one kind', () => {
    for (const capability of CREATIVE_CAPABILITIES) {
      const ids = capability.publishDestinations.map((destination) => destination.id);
      expect(new Set(ids).size, `${capability.kind} repeats a destination`).toBe(ids.length);
    }
  });
});
