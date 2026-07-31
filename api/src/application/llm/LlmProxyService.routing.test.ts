import { describe, expect, it } from 'vitest';
import {
  reorderPoolByShape,
  reorderPoolForQuality,
  isLowSchemaCeilingModel,
  isQualityCriticalUseCase,
  type ChatCompletionRequest,
} from './LlmProxyService';

const msgs = [{ role: 'user' as const, content: 'x' }];
const strictSchemaBody = {
  messages: msgs,
  response_format: { type: 'json_schema', json_schema: { name: 'X', strict: true, schema: { type: 'object' } } },
} as unknown as ChatCompletionRequest;
const jsonObjectBody = {
  messages: msgs,
  response_format: { type: 'json_object' },
} as unknown as ChatCompletionRequest;

// Verified tiers (see catalog): claude-sonnet-5 / gpt-4.1 / gemini-2.5-pro = PREMIUM,
// gemini-2.5-flash-lite / deepseek-v4-flash = STANDARD, *:free = FREE.
const CLAUDE = 'anthropic/claude-sonnet-5';     // PREMIUM, high-ceiling, structured
const GPT = 'openai/gpt-4.1';                    // PREMIUM, high-ceiling, structured
const GEMINI_LITE = 'google/gemini-2.5-flash-lite'; // STANDARD, LOW-ceiling
const GEMINI_PRO = 'google/gemini-2.5-pro';      // PREMIUM, LOW-ceiling
const GROK = 'x-ai/grok-3-mini';                 // tools-capable, NOT structured, NOT gemini
const QWEN_FREE = 'qwen/qwen3-coder:free';       // FREE, structured
const DEEPSEEK = 'deepseek/deepseek-v4-flash';   // STANDARD

describe('isLowSchemaCeilingModel', () => {
  it('flags the Gemini family (any routing vendor), nothing else', () => {
    expect(isLowSchemaCeilingModel('google/gemini-2.5-flash-lite')).toBe(true);
    expect(isLowSchemaCeilingModel('googleai/gemini-2.5-flash')).toBe(true);
    expect(isLowSchemaCeilingModel('google/gemini-2.5-pro')).toBe(true);
    expect(isLowSchemaCeilingModel('anthropic/claude-sonnet-5')).toBe(false);
    expect(isLowSchemaCeilingModel('openai/gpt-4.1')).toBe(false);
  });
});

describe('reorderPoolByShape — schema-ceiling preference (Feature 1)', () => {
  it('de-prioritizes a low-ceiling Gemini model for a STRICT json_schema', () => {
    const out = reorderPoolByShape(strictSchemaBody, [GEMINI_LITE, CLAUDE, GPT]);
    // High-ceiling structured models lead; Gemini sorts last.
    expect(out[out.length - 1]).toBe(GEMINI_LITE);
    expect(out.indexOf(CLAUDE)).toBeLessThan(out.indexOf(GEMINI_LITE));
    expect(out.indexOf(GPT)).toBeLessThan(out.indexOf(GEMINI_LITE));
  });

  it('the penalty isolates to strict schema: it only fires for json_schema, not json_object', () => {
    // GROK and GEMINI_LITE both score 0 capability for a structured request, so the
    // ONLY differentiator is the low-ceiling penalty.
    const strict = reorderPoolByShape(strictSchemaBody, [GEMINI_LITE, GROK]);
    expect(strict.indexOf(GROK)).toBeLessThan(strict.indexOf(GEMINI_LITE)); // penalty pushes Gemini back

    const loose = reorderPoolByShape(jsonObjectBody, [GEMINI_LITE, GROK]);
    expect(loose).toEqual([GEMINI_LITE, GROK]); // no penalty for loose json_object → input order
  });
});

describe('isQualityCriticalUseCase', () => {
  it('matches resume/cover-letter/tailor/proposal slugs, not unrelated ones', () => {
    expect(isQualityCriticalUseCase('resume_tailoring')).toBe(true);
    expect(isQualityCriticalUseCase('cover_letter_gen')).toBe(true);
    expect(isQualityCriticalUseCase('tailor_v2')).toBe(true);
    expect(isQualityCriticalUseCase('proposal_draft')).toBe(true);
    expect(isQualityCriticalUseCase('invoice_ocr')).toBe(false);
    expect(isQualityCriticalUseCase('chat')).toBe(false);
    expect(isQualityCriticalUseCase(undefined)).toBe(false);
  });
});

describe('reorderPoolForQuality — quality tier (Feature 2)', () => {
  it('leads with the highest-tier models the pool contains (PREMIUM → STANDARD → FREE)', () => {
    const out = reorderPoolForQuality([QWEN_FREE, DEEPSEEK, CLAUDE]);
    expect(out).toEqual([CLAUDE, DEEPSEEK, QWEN_FREE]);
  });

  it('is a no-op within an all-FREE pool (plan-respecting — free stays free)', () => {
    const freePool = ['minimax/minimax-m2.5:free', QWEN_FREE];
    expect(reorderPoolForQuality(freePool)).toEqual(freePool);
  });

  it('within a tier, keeps a low-ceiling Gemini last when strictSchema is set', () => {
    // Both PREMIUM; only the schema-ceiling penalty differentiates.
    expect(reorderPoolForQuality([GEMINI_PRO, CLAUDE], { strictSchema: true }))
      .toEqual([CLAUDE, GEMINI_PRO]);
    // Without strictSchema the within-tier input order is preserved.
    expect(reorderPoolForQuality([GEMINI_PRO, CLAUDE]))
      .toEqual([GEMINI_PRO, CLAUDE]);
  });
});
