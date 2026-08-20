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
import { VANILLA_TEMPLATE, MOBILE_TEMPLATE, templateForProject, isScaffoldPath } from './projectTemplate';
import {
  VANILLA_DEFAULTS,
  MOBILE_DEFAULTS,
  defaultsForModality,
  isScaffoldPath as isScaffoldPathClient,
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

  // The zero-byte-scaffold rule is enforced server-side but ALSO consulted by the
  // client (file-create seeds the template instead of posting an empty body), so
  // the two path sets must name the same files or the client will either send a
  // write the server refuses, or skip one it would have accepted.
  it('agrees on which paths a scaffold owns', () => {
    const paths = [...Object.keys(VANILLA_DEFAULTS), ...Object.keys(MOBILE_DEFAULTS)];
    for (const path of paths) {
      expect(isScaffoldPath(path)).toBe(true);
      expect(isScaffoldPathClient(path)).toBe(true);
    }
    for (const path of ['src/notes.txt', 'README.md', 'src/components/Card.jsx', '']) {
      expect(isScaffoldPath(path)).toBe(false);
      expect(isScaffoldPathClient(path)).toBe(false);
    }
  });
});
