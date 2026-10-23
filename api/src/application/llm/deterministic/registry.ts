/**
 * THE deterministic-handler registry (cost lever D7) — tried in order, first answer
 * wins. A new handler is a row here, never a branch in the gateway.
 *
 * Not here, deliberately: count / aggregate questions about tenant data ("how many
 * open tickets in project X"). The gateway's `completeChat` sees a caller's tenant,
 * project and principal ids for cache scoping, but no authorization context — no
 * membership or role check — and no read-only application port exists that counts
 * a project's open tickets for a principal. Answering one here would read tenant
 * data around the tool-authority layer (`builtinToolAuthority`) that every model
 * tool call goes through, so those questions keep going to a model with tools.
 */

import { arithmeticHandler } from './arithmetic';
import { dateArithmeticHandler } from './dateArithmetic';
import { unitConversionHandler } from './unitConversion';
import type { DeterministicAnswer, DeterministicHandler } from './types';

export const DETERMINISTIC_HANDLERS: readonly DeterministicHandler[] = [
  unitConversionHandler,
  dateArithmeticHandler,
  arithmeticHandler,
];

/** Longer messages are never a question one of these handlers answers. */
const MAX_QUESTION_CHARS = 200;

/** The first handler's answer to `question`, or null when none is sure. */
export function answerDeterministically(question: string, now: Date, handlers: readonly DeterministicHandler[] = DETERMINISTIC_HANDLERS): DeterministicAnswer | null {
  if (!question || question.length > MAX_QUESTION_CHARS) return null;
  for (const handler of handlers) {
    const answer = handler.answer(question, now);
    if (answer) return answer;
  }
  return null;
}
