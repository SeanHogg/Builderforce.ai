import { describe, it, expect } from 'vitest';
import { detectLatinLanguage, scoreEnglishWordiness } from './wordLexicon';

/**
 * The language guard decides ONE thing: may the English lexicon judge this text? Both
 * ways of getting that wrong are expensive — judging a genuine Spanish reply against an
 * English word list silently drops a real answer, and declining to judge English-shaped
 * gibberish is how a broken head was graded "usable" by the readiness suite.
 *
 * The rule that separates them is EVIDENCE: real prose in any language uses many
 * different function words, while gibberish sprays one or two accidental fragments.
 */
const words = (t: string) => t.toLowerCase().match(/\p{L}+/gu) ?? [];
const detect = (t: string) => detectLatinLanguage(words(t), t);

describe('detectLatinLanguage — which lexicon may judge this text', () => {
  it('identifies a genuine non-English reply and keeps English away from it', () => {
    const es = detect('El modelo del proyecto aprende de cada ejecución y guarda una nueva versión en el almacenamiento.');
    expect(es.language).toBe('es');
    expect(es.englishLeads).toBe(false);
  });

  it('lets English judge English', () => {
    const en = detect('The coordinator merges the queued contributions into the artifact and re-benchmarks it against a held-out set of prior examples.');
    expect(en.language).toBe('en');
    expect(en.englishLeads).toBe(true);
  });

  it('does not hand a language the win on one repeated fragment', () => {
    // `se` twice plus `al` is three Spanish function-word HITS but only two distinct
    // markers — the exact vote that made a gibberish probe sample read as Spanish.
    const v = detect('w. The - shade sade se ush what - dard se gote shaterelrede ushot shatush ushing al');
    expect(v.language).toBeNull();
    expect(v.englishLeads).toBe(true);
  });

  it('treats a tie as an English lead rather than a reason to judge nothing', () => {
    // `se` twice ties Spanish with English's two `the`s. Before, nothing won and the
    // text was passed unexamined.
    const v = detect('. rame shatd inf the brand te mis . I se me shelse se see branch branch sareated the branch');
    expect(v.language).toBeNull();
    expect(v.englishLeads).toBe(true);
  });

  it('reports non-Latin scripts as out of scope', () => {
    const v = detect('这个项目的模型会从每一次智能体运行中学习，并把新的版本保存到存储中。');
    expect(v.latin).toBe(false);
    expect(v.englishLeads).toBe(false);
  });
});

describe('scoreEnglishWordiness — evidence from short replies', () => {
  const score = (t: string) => {
    const raw: string[] = []; const core: string[] = [];
    for (const tok of t.split(/\s+/u)) {
      const c = tok.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '').toLowerCase().replace(/[''’-]/gu, '');
      if (!c || !/^\p{L}+$/u.test(c)) continue;
      raw.push(tok); core.push(c);
    }
    return scoreEnglishWordiness(core, raw);
  };

  it('scores a probe-length reply instead of declining for lack of evidence', () => {
    // 80 generated tokens is ~15 words. Skipping 3-letter tokens left this below the
    // scorer's own floor, so it returned "not scored" — read downstream as coherent.
    const s = score('. rame shatd inf the brand te mis . I se me shelse se see branch branch sareated the branch');
    expect(s.scored).toBe(true);
    expect(s.unknownShare).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps a short real answer comfortably below the accusation threshold', () => {
    const s = score('The build is green and the last two tickets are merged. Nothing is blocked right now.');
    expect(s.unknownShare).toBeLessThan(0.5);
  });
});
