import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const mocks = vi.hoisted(() => ({ record: vi.fn(async () => {}) }));
vi.mock('./savingsLedger', () => ({ recordAvoidedCall: mocks.record }));

import {
  ESTIMATED_SAVING_MAX_COMPLETION_TOKENS,
  ESTIMATED_SAVING_MAX_PROMPT_TOKENS,
  recordMemoryAnswerSavings,
} from './memoryAnswerSavings';

const base = { tenantId: 1, userId: 'u1', projectId: 2, chatId: 7, surface: 'web' as const, model: 'm' };

beforeEach(() => vi.clearAllMocks());

describe('recordMemoryAnswerSavings', () => {
  it('caps an ESTIMATED saving so a long question/answer cannot claim an outsized figure', async () => {
    await recordMemoryAnswerSavings({} as Env, {} as Db, {
      ...base,
      question: 'q'.repeat(400_000),
      answer: { text: 'a'.repeat(400_000), source: 'qa-cache' } as never,
    });
    const call = (mocks.record.mock.calls[0] as unknown as [Db, Env, Record<string, unknown>])[2];
    expect(call).toMatchObject({
      estimated: true,
      promptTokens: ESTIMATED_SAVING_MAX_PROMPT_TOKENS,
      completionTokens: ESTIMATED_SAVING_MAX_COMPLETION_TOKENS,
    });
  });

  it('records a server-recorded cost basis as measured', async () => {
    await recordMemoryAnswerSavings({} as Env, {} as Db, {
      ...base,
      question: 'q',
      answer: { text: 'a', source: 'qa-cache', costBasis: { model: 'served', promptTokens: 900, completionTokens: 120 } } as never,
    });
    const call = (mocks.record.mock.calls[0] as unknown as [Db, Env, Record<string, unknown>])[2];
    expect(call).toMatchObject({ estimated: false, model: 'served', promptTokens: 900, completionTokens: 120 });
  });
});
