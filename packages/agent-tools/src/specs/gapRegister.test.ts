import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { githubHeadingSlug, parseGapRegister, parseSpecAnchors } from './gapRegister';

const FIXTURE = [
  '# Roadmap',
  '',
  '- **[x] Not a gap,** above the register.',
  '',
  '## Consolidated Gap Register — by stage of the arc',
  '',
  '| Stage | Holds |',
  '|---|---|',
  '',
  '## 💡 Idea — Read · Prove',
  '',
  '- **[canvas] `creation_step` is never emitted,** so the family is incomplete. [idea.md › Canvas](./docs/specs/idea.md#operations--observe)',
  '- **[canvas] Ideas surface reads unfinished.** Lede repeats. Mockup: https://example.com/x. *Blocker: operator go-ahead.*',
  '',
  '---',
  '',
  '## 🔨 Make — Build',
  '',
  '### Cloud and IDE agent runs `[agents]`',
  '',
  '- **The PreFetch cache-hit is unmeasured.** Add the probe. [make.md › PreFetch](./docs/specs/make.md#done-checks)',
  '- **In VS Code, the guard\'s finish turn runs under chat.** Shipped 2026-11-16.',
  '  - The Brain host forces the finish from `progressGuard.ts`. [make.md](./docs/specs/make.md)',
  '  - Second sub-bullet.',
  '- **The PreFetch cache-hit is unmeasured.** A repeated summary.',
  '',
  '## 🧰 OTHER — enabling work',
  '',
  '### CI and release `[platform]` `[ci]`',
  '',
  '- **[agents] [infra] Deploys are slow,** see [run.md](run.md) and [web](https://x.y/z.md).',
].join('\n');

describe('parseGapRegister', () => {
  const gaps = parseGapRegister(FIXTURE);

  it('reads only the register, one entry per top-level bullet', () => {
    expect(gaps.map((g) => g.stage)).toEqual(['idea', 'idea', 'make', 'make', 'make', 'other']);
    expect(gaps.find((g) => g.summary === 'Not a gap')).toBeUndefined();
  });

  it('splits tag, summary, body, links and blocker', () => {
    expect(gaps[0]).toMatchObject({
      id: 'idea/creation-step-is-never-emitted',
      group: null,
      tags: ['canvas'],
      summary: '`creation_step` is never emitted',
      specLinks: [{ file: 'docs/specs/idea.md', anchor: 'operations--observe' }],
      blocker: null,
      line: 12,
    });
    expect(gaps[0]!.body).toMatch(/^so the family is incomplete/);
    expect(gaps[1]).toMatchObject({ summary: 'Ideas surface reads unfinished', blocker: 'operator go-ahead', specLinks: [] });
  });

  it('takes group tags, keeps sub-bullets with their parent, and suffixes a repeated id', () => {
    expect(gaps[2]).toMatchObject({ group: 'Cloud and IDE agent runs', tags: ['agents'], id: 'make/the-prefetch-cache-hit-is-unmeasured' });
    expect(gaps[3]!.body).toContain('progressGuard.ts');
    expect(gaps[3]!.body).toContain('Second sub-bullet.');
    expect(gaps[3]!.specLinks).toEqual([{ file: 'docs/specs/make.md', anchor: null }]);
    expect(gaps[4]!.id).toBe('make/the-prefetch-cache-hit-is-unmeasured-2');
  });

  it('merges bold tags before group tags and ignores web links', () => {
    expect(gaps[5]).toMatchObject({
      tags: ['agents', 'infra', 'platform', 'ci'],
      summary: 'Deploys are slow',
      group: 'CI and release',
      specLinks: [{ file: 'run.md', anchor: null }],
    });
  });

  it('keeps a `*` inside a blocker and a malformed percent-encoded anchor as written', () => {
    const [gap] = parseGapRegister([
      '## Consolidated Gap Register',
      '## 🔨 Make — Build',
      '- **Glob support,** see [make.md](./docs/specs/make.md#100%-done). *Blocker: needs `src/*` globs first.*',
    ].join('\n'));
    expect(gap!.blocker).toBe('needs `src/*` globs first');
    expect(gap!.specLinks).toEqual([{ file: 'docs/specs/make.md', anchor: '100%-done' }]);
  });

  it('returns [] without the register heading', () => {
    expect(parseGapRegister('# Roadmap\n\n- **A gap.** body')).toEqual([]);
  });
});

describe('parseSpecAnchors', () => {
  it('follows GitHub slug rules: emoji and punctuation stripped, repeats suffixed', () => {
    const md = [
      '# 💡 Idea — Read · Prove',
      '## Done checks',
      '## Done checks',
      '## Done checks',
      '### PRD 41 §B10: who reads it?',
      '## ⚙️ Run — operate',
      '## A [link](http://x) and `code`',
      '```',
      '## not a heading',
      '```',
      '<a id="custom-anchor"></a>',
    ].join('\n');
    const anchors = parseSpecAnchors(md);
    expect([...anchors]).toEqual([
      '-idea--read--prove', 'done-checks', 'done-checks-1', 'done-checks-2',
      'prd-41-b10-who-reads-it', '️-run--operate', 'a-link-and-code', 'custom-anchor',
    ]);
    expect(anchors.has('not-a-heading')).toBe(false);
  });

  it('matches the anchors ROADMAP.md links to its own stages', () => {
    expect(githubHeadingSlug('💡 Idea — Read · Prove')).toBe('-idea--read--prove');
    expect(githubHeadingSlug('⚙️ Run — operate the company')).toBe('️-run--operate-the-company');
    // The link the real ROADMAP.md stage table uses for the Run stage.
    expect(parseSpecAnchors('## ⚙️ Run — operate the company').has('️-run--operate-the-company')).toBe(true);
  });
});

describe('the real Builderforce.ai/ROADMAP.md', () => {
  const markdown = readFileSync(fileURLToPath(new URL('../../../../ROADMAP.md', import.meta.url).href), 'utf8');
  const gaps = parseGapRegister(markdown);

  it('parses every gap with a stage and a summary, under unique ids', () => {
    expect(gaps.length).toBeGreaterThan(50);
    for (const g of gaps) {
      expect(g.stage).toMatch(/^[a-z]+$/);
      expect(g.summary.trim()).not.toBe('');
    }
    expect(new Set(gaps.map((g) => g.id)).size).toBe(gaps.length);
    expect(new Set(gaps.map((g) => g.stage))).toEqual(new Set(['idea', 'make', 'run', 'measure', 'reach', 'other']));
  });
});
