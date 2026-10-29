import { describe, expect, it } from 'vitest';
import { truncatedResultNote } from './index.js';

describe('truncatedResultNote', () => {
  it('counts chars and says the result is not the whole', () => {
    const note = truncatedResultNote(123_456, 16_000);
    expect(note).toContain('123,456 chars');
    expect(note).toContain('NOT the whole');
  });

  it('is compact when the cap is tiny, so it rides inside the cap it describes', () => {
    expect(truncatedResultNote(50_000, 400).length).toBeLessThan(120);
  });
});
