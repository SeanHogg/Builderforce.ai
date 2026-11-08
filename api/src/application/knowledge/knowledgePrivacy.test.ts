/**
 * The privacy bound is memory's (PRD 38 §5.2): `clampClaim` and the label bound are stated ONCE
 * there, so these tests name them by memory's exported constants, never by a copy of the
 * numbers. What belongs to this module — `clampExtracted` — and what the writer relies on from
 * memory — a model's claim is bounded, idempotently, and judge output passes through unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CLAIM_TEXT_CHARS, MAX_QUOTE_CHARS, MAX_QUOTE_LINES, clampClaim, type Extracted, type NodeRef,
} from '@seanhogg/builderforce-memory/knowledge';
import { clampExtracted, sanitizeExtracted } from './knowledgePrivacy';

describe('clampClaim (memory’s, as the writer applies it to a model’s fact)', () => {
  it('keeps at most MAX_QUOTE_LINES lines of a claim', () => {
    const lines = Array.from({ length: MAX_QUOTE_LINES + 2 }, (_, i) => `l${i + 1}`);
    expect(clampClaim(lines.join('\n')).split('\n')).toEqual(lines.slice(0, MAX_QUOTE_LINES));
  });

  it('caps a one-line claim with no quote at its own text limit', () => {
    expect(clampClaim('x'.repeat(20_000))).toHaveLength(MAX_CLAIM_TEXT_CHARS);
  });

  it('keeps a long claim whole and bounds only its quote, instead of cutting the claim mid-quote', () => {
    const text = 'y'.repeat(MAX_CLAIM_TEXT_CHARS);
    const clamped = clampClaim(`${text} — “${'q'.repeat(20_000)}”`);
    expect(clamped.startsWith(`${text} — “`)).toBe(true);
    expect(clamped.endsWith('”')).toBe(true);
    expect(clamped.length).toBeLessThanOrEqual(MAX_CLAIM_TEXT_CHARS + ' — “”'.length + MAX_QUOTE_CHARS);
  });

  it('bounds the claim text and the quote independently', () => {
    const clamped = clampClaim(`${'t'.repeat(5_000)} — “short quote”`);
    expect(clamped).toBe(`${'t'.repeat(MAX_CLAIM_TEXT_CHARS)} — “short quote”`);
  });

  it('drops an EMPTY quote: the canonical form carries none (the old local copy kept “”)', () => {
    expect(clampClaim('a says b — “”')).toBe('a says b');
  });

  it('is idempotent, and leaves a short claim or a judge’s own output as it is', () => {
    expect(clampClaim('a says b')).toBe('a says b');
    const judged = 'the contract renews yearly — “renews each 12 months”';
    expect(clampClaim(judged)).toBe(judged);
    const once = clampClaim(`${'z'.repeat(5_000)} — “${'q'.repeat(5_000)}”`);
    expect(clampClaim(once)).toBe(once);
  });
});

describe('clampExtracted', () => {
  it('reduces every node label to one line, leaving the rest of the output untouched', () => {
    const extracted: Extracted[] = [{
      sourceRef: 'src:r::a.md', sourceHash: 'h',
      nodes: [{ ref: 'src:r::a.md', kind: 'file', label: 'first line\nsecond line\nthird', pack: 'docs', importance: 0, origin: 'extracted', sourceHash: 'h' }],
      edges: [], keys: [],
    }];
    const out = clampExtracted(extracted);
    expect(out[0]!.nodes[0]!.label).not.toContain('\n');
    expect(out[0]!.nodes[0]!.label.startsWith('first line')).toBe(true);
    expect(out[0]).toMatchObject({ sourceRef: 'src:r::a.md', sourceHash: 'h', edges: [], keys: [] });
    expect(extracted[0]!.nodes[0]!.label).toContain('\n');
  });
});

const entry = (path: string, hash: string): Extracted => ({
  sourceRef: `src:r::${path}`, sourceHash: hash,
  nodes: [{ ref: `src:r::${path}`, kind: 'file', label: 'a.md', pack: 'docs', importance: 0, origin: 'extracted' }],
  edges: [], keys: [],
});

describe('sanitizeExtracted', () => {
  it('drops individual refs over 512 chars, keeps the rest, and reports the skipped count', () => {
    const long = `src:r::${'a'.repeat(600)}` as NodeRef; // a deep-path ref a producer emitted over the bound
    const bad = entry('bad.md', 'h');
    bad.nodes.push({ ref: long, kind: 'symbol', label: 'over-long', pack: 'docs', importance: 0, origin: 'extracted' });
    bad.edges.push({ from: `src:r::bad.md`, to: long, kind: 'calls', weight: 1, origin: 'extracted' });
    bad.keys.push({ ref: long, key: 'k' });
    const good = entry('good.md', 'h');
    const { entries: stored, skippedRefs } = sanitizeExtracted([bad, good]);
    expect(skippedRefs).toBe(3);
    expect(stored.map((e) => e.sourceRef)).toEqual(['src:r::bad.md', 'src:r::good.md']);
    expect(stored[0]!.nodes.map((n) => n.ref)).toEqual(['src:r::bad.md']);
    expect(stored[0]!.edges).toEqual([]);
    expect(stored[0]!.keys).toEqual([]);
    for (const e of stored) {
      expect(e.sourceRef.length).toBeLessThanOrEqual(512);
      for (const n of e.nodes) expect(n.ref.length).toBeLessThanOrEqual(512);
    }
  });

  it('drops an entire entry whose sourceRef is over 512 chars, counting everything it carried', () => {
    const bad = entry(`${'b'.repeat(600)}.md`, 'h');
    const { entries: stored, skippedRefs } = sanitizeExtracted([bad, entry('good.md', 'h')]);
    expect(skippedRefs).toBe(2); // the entry + its one node
    expect(stored.map((e) => e.sourceRef)).toEqual(['src:r::good.md']);
  });
});
