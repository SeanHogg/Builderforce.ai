import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_STAGES } from './pipelineProjection';

const repo = resolve(__dirname, '..', '..', '..', '..');

/**
 * The stage ladder is written down twice — once here and once in the canvas's
 * `canvasSalesPipeline.ts`, which cannot be imported across the package boundary.
 *
 * A silent divergence is not cosmetic: the canvas would draw a column the API
 * refuses to move a deal into, and the failure surfaces as a card that springs
 * back with an error nobody can explain from either file alone. So the two are
 * held together HERE, by reading the other one off disk — the same technique
 * `entityCatalog.test.ts` uses to hold the catalog against the migrations.
 */
describe('the fallback stage ladder', () => {
  it('is identical to the canvas’s DEFAULT_PIPELINE_STAGES', () => {
    const source = readFileSync(resolve(repo, 'frontend/src/lib/canvasSalesPipeline.ts'), 'utf8');
    const match = source.match(/DEFAULT_PIPELINE_STAGES\s*=\s*\[([^\]]*)\]/);
    expect(match, 'DEFAULT_PIPELINE_STAGES was renamed or moved — this contract needs re-pointing, not deleting').not.toBeNull();
    const canvasStages = [...(match?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(canvasStages).toEqual([...FALLBACK_STAGES]);
  });

  it('ends with the two terminal stages, in that order', () => {
    // `moveDeal` derives `deals.outcome` from the stage when a tenant has declared
    // none of their own, and it does that by NAME. If these move, a deal dragged
    // to "won" stops being counted as won by every report on the platform.
    expect(FALLBACK_STAGES.slice(-2)).toEqual(['won', 'lost']);
  });
});
