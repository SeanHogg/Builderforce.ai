import { describe, expect, it } from 'vitest';
import { primaryRealizationDoc } from './canvasRealize';

describe('primaryRealizationDoc', () => {
  it('picks the one generated markdown charter over the HTML consoles beside it', () => {
    const doc = primaryRealizationDoc({
      'phone.html': '<html></html>',
      'phone-line/runbook.md': '# Runbook\n\nWiring it up…',
    });
    expect(doc).toEqual({ path: 'phone-line/runbook.md', content: '# Runbook\n\nWiring it up…' });
  });

  it('returns null when the target produced no markdown doc', () => {
    expect(primaryRealizationDoc({ 'index.html': '<html></html>' })).toBeNull();
  });

  it('returns null for an empty file map', () => {
    expect(primaryRealizationDoc({})).toBeNull();
  });
});
