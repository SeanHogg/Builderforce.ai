import { describe, expect, it } from 'vitest';
import {
  contentTokens,
  coverage,
  tokenF1,
  lexicalEval,
  buildJudgePrompt,
  parseJudgeVerdict,
  evaluateResponse,
  EVAL_WEIGHTS,
} from './semanticEval';

describe('lexical primitives', () => {
  it('contentTokens drops stopwords and 1-char noise, de-duplicates', () => {
    const t = contentTokens('The quick a I quick FOX!');
    expect(t.has('quick')).toBe(true);
    expect(t.has('fox')).toBe(true);
    expect(t.has('the')).toBe(false); // stopword
    expect(t.has('a')).toBe(false); // stopword + 1-char
    expect(t.has('i')).toBe(false); // 1-char
  });

  it('coverage is the fraction of needle present in haystack; empty needle = 1', () => {
    expect(coverage(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBe(1);
    expect(coverage(new Set(['a', 'b']), new Set(['a']))).toBe(0.5);
    expect(coverage(new Set(), new Set(['a']))).toBe(1);
  });

  it('tokenF1 is symmetric overlap; handles empty sets', () => {
    expect(tokenF1(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(tokenF1(new Set(), new Set())).toBe(1);
    expect(tokenF1(new Set(['a']), new Set())).toBe(0);
    expect(tokenF1(new Set(['x']), new Set(['y']))).toBe(0);
    expect(tokenF1(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(0.5, 6);
  });
});

describe('lexicalEval', () => {
  it('grounds faithfulness in context when context is present', () => {
    const s = lexicalEval({
      question: 'which database should I use for postgres',
      answer: 'use pgvector because it runs inside postgres',
      context: 'pgvector is a postgres extension for vector search',
    });
    expect(s.method).toBe('lexical');
    expect(s.faithfulness).toBeGreaterThan(0);
    expect(s.contextRelevance).toBeGreaterThan(0);
    expect(s.hallucinationRate).toBeCloseTo(1 - s.faithfulness, 6);
  });

  it('with no context, faithfulness mirrors answer-relevance and contextRelevance is 0', () => {
    const s = lexicalEval({
      question: 'configure the cache layer',
      answer: 'configure the cache layer with a read-through helper',
    });
    expect(s.contextRelevance).toBe(0);
    expect(s.faithfulness).toBe(s.answerRelevance);
    // overall collapses onto answer-relevance with no context.
    expect(s.overall).toBeCloseTo(s.answerRelevance, 6);
  });

  it('an ungrounded answer scores low faithfulness / high hallucination', () => {
    const s = lexicalEval({
      question: 'how do I deploy on cloudflare',
      answer: 'bananas are an excellent source of potassium',
      context: 'cloudflare workers deploy via wrangler publish',
    });
    expect(s.faithfulness).toBeLessThan(0.3);
    expect(s.hallucinationRate).toBeGreaterThan(0.7);
  });

  it('weights are normalised to 1', () => {
    const sum = EVAL_WEIGHTS.faithfulness + EVAL_WEIGHTS.answerRelevance + EVAL_WEIGHTS.contextRelevance;
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('LLM-as-judge backend', () => {
  it('buildJudgePrompt embeds question, context, and answer', () => {
    const p = buildJudgePrompt({ question: 'Q?', answer: 'A.', context: 'C.' });
    expect(p).toContain('Q?');
    expect(p).toContain('A.');
    expect(p).toContain('C.');
    expect(p).toContain('faithfulness');
  });

  it('buildJudgePrompt notes when no context was provided', () => {
    expect(buildJudgePrompt({ question: 'Q', answer: 'A' })).toContain('(none provided)');
  });

  it('parseJudgeVerdict extracts and clamps a JSON verdict', () => {
    const v = parseJudgeVerdict(
      'Here is my verdict: {"faithfulness":1.2,"answer_relevance":0.8,"context_relevance":-0.5,"hallucination_rate":0.1} done',
    );
    expect(v).not.toBeNull();
    expect(v!.faithfulness).toBe(1); // clamped from 1.2
    expect(v!.answerRelevance).toBe(0.8);
    expect(v!.contextRelevance).toBe(0); // clamped from -0.5
    expect(v!.hallucinationRate).toBe(0.1);
  });

  it('parseJudgeVerdict derives hallucination_rate from faithfulness when absent', () => {
    const v = parseJudgeVerdict('{"faithfulness":0.9,"answer_relevance":0.5,"context_relevance":0.5}');
    expect(v!.hallucinationRate).toBeCloseTo(0.1, 6);
  });

  it('parseJudgeVerdict returns null for no-JSON and for malformed JSON', () => {
    expect(parseJudgeVerdict('no json here')).toBeNull();
    expect(parseJudgeVerdict('{not valid json}')).toBeNull();
  });

  it('parseJudgeVerdict coerces string numerics', () => {
    const v = parseJudgeVerdict('{"faithfulness":"0.7","answer_relevance":"0.6","context_relevance":"0.5"}');
    expect(v!.faithfulness).toBeCloseTo(0.7, 6);
  });
});

describe('evaluateResponse', () => {
  const materials = { question: 'use postgres vector db', answer: 'pgvector', context: 'pgvector postgres' };

  it('uses the judge when one is supplied and parseable', async () => {
    const judge = async () =>
      '{"faithfulness":0.95,"answer_relevance":0.9,"context_relevance":0.85,"hallucination_rate":0.05}';
    const s = await evaluateResponse(materials, { judge });
    expect(s.method).toBe('llm');
    expect(s.faithfulness).toBe(0.95);
    expect(s.overall).toBeGreaterThan(0.8);
  });

  it('falls back to lexical when the judge returns garbage', async () => {
    const judge = async () => 'I refuse to answer';
    const s = await evaluateResponse(materials, { judge });
    expect(s.method).toBe('lexical');
  });

  it('falls back to lexical when the judge throws', async () => {
    const judge = async () => {
      throw new Error('gateway down');
    };
    const s = await evaluateResponse(materials, { judge });
    expect(s.method).toBe('lexical');
  });

  it('uses lexical when no judge is supplied', async () => {
    const s = await evaluateResponse(materials);
    expect(s.method).toBe('lexical');
  });
});
