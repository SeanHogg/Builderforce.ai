/**
 * The IDE starter templates are ONE module now — this proves both runtimes reach it.
 *
 * ── WHAT CHANGED ────────────────────────────────────────────────────────────────
 * The scaffold used to exist as two byte-identical copies (the API's
 * `projectTemplate.ts`, which SEEDS them into R2, and the frontend's
 * `vanillaDefaults.ts`, which mounts them as the Run fallback), held together by a
 * byte-for-byte assertion here because neither package could import the other.
 *
 * They still drifted, and it shipped a broken product: the frontend knew about the
 * `webmobile` modality and the API's registry did not, so "Web + Mobile" projects were
 * created with no files at all. The comparison could not catch it, because the two
 * FILE MAPS agreed — it was the modality→template DECISION that had forked.
 *
 * Both now import `@builderforce/ide-templates`, so the file maps are identical by
 * construction and the decision is a single `templateForModality`. What is left to
 * test is not equality but REACHABILITY: that both consumers still resolve the shared
 * module (the alias exists in `api/tsconfig.json` + `api/vitest.config.ts` and in
 * `frontend/tsconfig.json`), and that neither has quietly reintroduced a local copy.
 */
import { describe, it, expect } from 'vitest';
import { VANILLA_TEMPLATE, MOBILE_TEMPLATE, templateForProject } from './projectTemplate';
import * as shared from '@builderforce/ide-templates';
import {
  VANILLA_DEFAULTS,
  MOBILE_DEFAULTS,
  defaultsForModality,
} from '../../../../frontend/src/lib/vanillaDefaults';

describe('IDE templates are one shared module', () => {
  /**
   * Reference equality, not deep equality. `toEqual` would still pass if someone
   * reintroduced a local copy with the same contents — which is the exact state this
   * change exists to end — so identity is the assertion that means anything now.
   */
  it('the API seeds the SAME object the shared package exports', () => {
    expect(VANILLA_TEMPLATE).toBe(shared.VANILLA_TEMPLATE);
    expect(MOBILE_TEMPLATE).toBe(shared.MOBILE_TEMPLATE);
  });

  it('the frontend Run fallback is the SAME object the shared package exports', () => {
    expect(VANILLA_DEFAULTS).toBe(shared.VANILLA_TEMPLATE);
    expect(MOBILE_DEFAULTS).toBe(shared.MOBILE_TEMPLATE);
  });

  /**
   * The decision, not just the data. The API resolves a template from a project ROW
   * and the frontend from the live modality; both must land on the same scaffold, or a
   * project is seeded with one and run with the other. `webmobile` is the regression
   * case and is listed explicitly.
   */
  it.each(['designer', 'mobile', 'webmobile'])('agrees on the %s scaffold', (modality) => {
    const seeded = templateForProject({
      id: 1,
      template: null,
      modality,
      sourceControlRepoFullName: null,
      githubRepoUrl: null,
    });
    expect(seeded).toBe(defaultsForModality(modality));
  });

  /** A modality that never runs the Vite app must seed nothing rather than a scaffold. */
  it.each(['video', 'evermind', 'finetune', 'voice'])('seeds no scaffold for %s', (modality) => {
    expect(shared.templateForModality(modality)).toBeNull();
  });

  /** Every scaffold the registry can select must be non-empty — an empty map is the
   *  failure mode that left workspaces blank, and it is silent without this. */
  it('exposes only non-empty scaffolds', () => {
    const entries = Object.entries(shared.TEMPLATES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, files] of entries) {
      expect(Object.keys(files).length, `${name} scaffold is empty`).toBeGreaterThan(0);
    }
  });
});
