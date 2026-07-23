/**
 * Drift guard for the IDE starter templates.
 *
 * The scaffold exists in TWO runtimes that cannot share a module: the API
 * (Cloudflare Worker) SEEDS it into R2 at project creation, and the frontend
 * keeps the same files as the run-only fallback the WebContainer mounts when a
 * workspace file is missing or empty. Since neither package can import the
 * other, this test is what keeps them one source in practice.
 *
 * They drifted once already and it shipped a broken product: the frontend knew
 * about the `webmobile` modality while the API's template registry did not, so
 * "Web + Mobile" projects were created with no files at all. A byte-for-byte
 * assertion turns that class of silent divergence into a failing test.
 */
import { describe, it, expect } from 'vitest';
import { VANILLA_TEMPLATE, MOBILE_TEMPLATE, templateForProject } from './projectTemplate';
import {
  VANILLA_DEFAULTS,
  MOBILE_DEFAULTS,
  defaultsForModality,
} from '../../../../frontend/src/lib/vanillaDefaults';

describe('IDE template parity (api ↔ frontend)', () => {
  it('seeds byte-identical vanilla files to the ones Run falls back on', () => {
    expect(VANILLA_TEMPLATE).toEqual(VANILLA_DEFAULTS);
  });

  it('seeds byte-identical mobile files to the ones Run falls back on', () => {
    expect(MOBILE_TEMPLATE).toEqual(MOBILE_DEFAULTS);
  });

  // The two sides pick a template independently — the API from the project row,
  // the frontend from the live modality. Every modality that runs code must
  // agree, or a project gets seeded with one scaffold and run with the other.
  it.each(['designer', 'mobile', 'webmobile'])('agrees on the %s scaffold', (modality) => {
    const seeded = templateForProject({
      id: 1,
      template: null,
      modality,
      sourceControlRepoFullName: null,
      githubRepoUrl: null,
    });
    expect(seeded).toEqual(defaultsForModality(modality));
  });
});
