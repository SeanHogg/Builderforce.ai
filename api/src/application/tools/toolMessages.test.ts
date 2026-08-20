import { describe, expect, it } from 'vitest';
import { TOOLS, getTool } from './toolDefinitions';
import {
  TRANSLATED_TOOL_LOCALES,
  localizeTool,
  toolCatalog,
  toolMessageEntries,
} from './toolMessages';
import { resultCopy } from './resultCopy';
import { scoreQuestionnaire, type QuestionnaireTool } from './toolTypes';

/** Every key the registry's definitions need translated, with its English source. */
const ENTRIES = TOOLS.flatMap((t) => toolMessageEntries(t));

describe('the tool message catalog', () => {
  it.each(TRANSLATED_TOOL_LOCALES)('translates every string a tool definition serves — %s', (locale) => {
    // Asserted on key PRESENCE, deliberately not on "differs from the English".
    // Those are different questions and the second one is wrong: `%`, `$`,
    // `Initial`, `Remote` and a company name are all correct unchanged in several
    // of these languages, so a difference test would demand that a translator
    // make them worse to keep the build green. This is the guarantee
    // `emailMessages.ts` gets from an exhaustive interface; these keys are
    // generated from data, so it is asserted rather than declared.
    const catalog = toolCatalog(locale) ?? {};
    const missing = ENTRIES.map(([key]) => key).filter((key) => !(key in catalog));
    expect(
      missing,
      `${locale} is missing ${missing.length} tool string(s). Add them to toolMessages.${locale}.ts.`,
    ).toEqual([]);
  });

  it('has no catalog entry for a key no tool serves', () => {
    // The other direction: a key left behind by a renamed section is dead weight
    // that reads as coverage while translating nothing anyone can see.
    const served = new Set(ENTRIES.map(([key]) => key));
    for (const locale of TRANSLATED_TOOL_LOCALES) {
      const stale = Object.keys(toolCatalog(locale) ?? {}).filter((key) => !served.has(key));
      expect(stale, `${locale} carries dead keys: ${stale.join(', ')}`).toEqual([]);
    }
  });

  it('leaves English untouched — the definitions ARE the English copy', () => {
    for (const tool of TOOLS) expect(localizeTool(tool, 'en')).toBe(tool);
  });
});

describe('localizeTool', () => {
  it('swaps a questionnaire’s own copy, structure for structure', () => {
    const en = getTool('agentic-maturity') as QuestionnaireTool;
    const fr = localizeTool(en, 'fr') as QuestionnaireTool;

    expect(fr.id).toBe(en.id);
    expect(fr.name).not.toBe(en.name);
    expect(fr.sections.map((s) => s.key)).toEqual(en.sections.map((s) => s.key));
    expect(fr.sections[0]!.questions.map((q) => q.id)).toEqual(en.sections[0]!.questions.map((q) => q.id));
    // Identity is structural and must NEVER be translated — a translated section
    // key would break the framework lens, the saved answers and the data provider
    // all at once.
    expect(fr.sections[0]!.name).not.toBe(en.sections[0]!.name);
    expect(fr.scale.map((a) => a.value)).toEqual(en.scale.map((a) => a.value));
  });

  it('keeps every calculator input id and default intact', () => {
    const en = TOOLS.filter((t) => t.kind === 'calculator');
    for (const tool of en) {
      const de = localizeTool(tool, 'de');
      if (tool.kind !== 'calculator' || de.kind !== 'calculator') throw new Error('kind changed');
      expect(de.inputs.map((i) => i.id)).toEqual(tool.inputs.map((i) => i.id));
      expect(de.inputs.map((i) => i.default)).toEqual(tool.inputs.map((i) => i.default));
      expect(de.inputs.flatMap((i) => (i.options ?? []).map((o) => o.value)))
        .toEqual(tool.inputs.flatMap((i) => (i.options ?? []).map((o) => o.value)));
    }
  });

  it('keeps every quiz option at its own level', () => {
    for (const tool of TOOLS.filter((t) => t.kind === 'quiz')) {
      const es = localizeTool(tool, 'es');
      if (tool.kind !== 'quiz' || es.kind !== 'quiz') throw new Error('kind changed');
      expect(es.questions.map((q) => q.options.map((o) => o.level)))
        .toEqual(tool.questions.map((q) => q.options.map((o) => o.level)));
      expect(es.levels.map((l) => l.level)).toEqual(tool.levels.map((l) => l.level));
    }
  });
});

describe('a localized RESULT', () => {
  const answers = Object.fromEntries(
    (getTool('agentic-maturity') as QuestionnaireTool).sections
      .flatMap((s) => s.questions)
      .map((q) => [q.id, 3]),
  );

  it('carries the tool’s own copy AND the engine’s chrome in one language', () => {
    const tool = localizeTool(getTool('agentic-maturity')!, 'fr') as QuestionnaireTool;
    const result = scoreQuestionnaire(tool, answers, resultCopy('fr'));

    // The chrome — this is what a definition-only translation could not reach.
    expect(result.headline).toContain('Niveau');
    expect(result.scoreLabel).toBe('Défini');
    // …and the tool's own section names, from the SAME catalog entry the question
    // came from, which is why there is no second translation pass.
    expect(result.metrics[0]!.label).toBe(tool.sections[0]!.name);
    expect(result.recommendations[0]!.title).toContain('vers le niveau');
  });

  it('scores identically in every language — a lens on words, not on numbers', () => {
    const en = scoreQuestionnaire(getTool('agentic-maturity') as QuestionnaireTool, answers);
    for (const locale of TRANSLATED_TOOL_LOCALES) {
      const localized = scoreQuestionnaire(
        localizeTool(getTool('agentic-maturity')!, locale) as QuestionnaireTool,
        answers,
        resultCopy(locale),
      );
      expect(localized.score).toBe(en.score);
      expect(localized.metrics.map((m) => m.key)).toEqual(en.metrics.map((m) => m.key));
      expect(localized.metrics.map((m) => m.tier)).toEqual(en.metrics.map((m) => m.tier));
    }
  });
});
