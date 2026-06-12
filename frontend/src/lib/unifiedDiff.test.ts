import { describe, expect, it } from 'vitest';
import { unifiedDiff } from './unifiedDiff';

describe('unifiedDiff', () => {
  it('renders a created file as all-additions', () => {
    const out = unifiedDiff('a.ts', 'created', null, 'line1\nline2');
    expect(out).toContain('### CREATED a.ts');
    expect(out).toContain('+line1');
    expect(out).toContain('+line2');
  });

  it('renders a deleted file as all-removals', () => {
    const out = unifiedDiff('a.ts', 'deleted', 'old1\nold2', null);
    expect(out).toContain('### DELETED a.ts');
    expect(out).toContain('-old1');
  });

  it('shows -/+ for a modified line and keeps unchanged context', () => {
    const base = 'a\nb\nc';
    const cur = 'a\nB\nc';
    const out = unifiedDiff('x.ts', 'modified', base, cur);
    expect(out).toContain('-b');
    expect(out).toContain('+B');
    expect(out).toContain(' a');
    expect(out).toContain(' c');
  });

  it('collapses long unchanged runs into a context marker', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `L${i}`);
    const base = lines.join('\n');
    const cur = ['CHANGED', ...lines.slice(1)].join('\n'); // change first line only
    const out = unifiedDiff('big.ts', 'modified', base, cur);
    expect(out).toContain('-L0');
    expect(out).toContain('+CHANGED');
    expect(out).toMatch(/@@ … \d+ unchanged lines … @@/);
  });

  it('falls back to new content for very large files', () => {
    const base = Array.from({ length: 900 }, (_, i) => `a${i}`).join('\n');
    const cur = Array.from({ length: 900 }, (_, i) => `b${i}`).join('\n');
    const out = unifiedDiff('huge.ts', 'modified', base, cur);
    expect(out).toContain('too large for an inline diff');
    expect(out).toContain('b0');
  });
});
