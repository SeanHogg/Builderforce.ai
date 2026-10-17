/**
 * What a memory-first answer SAVED — the bridge from a {@link MemoryAnswer} hit to an
 * avoided-call row on the usage ledger (`savingsLedger.recordAvoidedCall`).
 *
 * Two cases, and the difference between them is the whole point of the ledger:
 *
 *   qa-cache WITH a recorded cost basis  → MEASURED. The replayed answer was produced by
 *     a real model turn whose model and token counts were stored with it (1228); a
 *     replay avoids exactly that turn again.
 *   qa-cache without one, or Evermind    → ESTIMATED. The question and answer are
 *     counted at ~4 chars/token and priced against the model the chat would have run.
 *     That under-counts (a real turn also sends the system prompt, history and tools),
 *     which is the safe direction for a figure that claims money was saved.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { MemoryAnswer } from './projectMemory';
import { estimateTokensFromText } from '@builderforce/workload';
import { recordAvoidedCall } from './savingsLedger';
import type { UsageSurface } from './usageLedger';

export interface MemoryAnswerSavingsInput {
  tenantId: number;
  userId: string | null;
  projectId: number;
  chatId: number | null;
  surface: UsageSurface;
  /** The model the chat would have run this turn on (the caller's served/selected model). */
  model: string | null;
  question: string;
  answer: MemoryAnswer;
}

export function recordMemoryAnswerSavings(env: Env, db: Db, input: MemoryAnswerSavingsInput): Promise<void> {
  const { answer } = input;
  const base = {
    tenantId: input.tenantId,
    userId: input.userId,
    projectId: input.projectId,
    chatId: input.chatId,
    surface: input.surface,
  };
  if (answer.source === 'qa-cache' && answer.costBasis) {
    return recordAvoidedCall(db, env, {
      ...base,
      source: 'memory_answer',
      model: answer.costBasis.model,
      promptTokens: answer.costBasis.promptTokens,
      completionTokens: answer.costBasis.completionTokens,
      estimated: false,
    });
  }
  return recordAvoidedCall(db, env, {
    ...base,
    source: answer.source === 'evermind' ? 'evermind_answer' : 'memory_answer',
    model: input.model,
    promptTokens: estimateTokensFromText(input.question),
    completionTokens: estimateTokensFromText(answer.text),
    estimated: true,
  });
}
