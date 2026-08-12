import { describe, expect, it } from 'vitest';
import { applyResumeBulletConsolidation, suggestResumeBulletConsolidation } from './canvasResumeConsolidate';

describe('resume bullet consolidation', () => {
  it('finds near-duplicate achievements across entries and applies only selected suggestions', () => {
    const document = { work: [
      { name: 'A', highlights: ['Reduced cloud costs by 30% through rightsizing', 'Led a five-person team'] },
      { name: 'B', highlights: ['Reduced cloud cost 30% using rightsizing', 'Launched a new product'] },
    ] };
    const suggestions = suggestResumeBulletConsolidation(document);
    expect(suggestions).toHaveLength(1);
    const merged = applyResumeBulletConsolidation(document, suggestions);
    expect(merged.work?.[0]?.highlights).toHaveLength(2);
    expect(merged.work?.[1]?.highlights).toEqual(['Launched a new product']);
    expect(document.work[1]!.highlights).toHaveLength(2);
  });
});
