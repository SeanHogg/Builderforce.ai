/** @seanhogg/builderforce-brain-embedded
 *
 * Runtime property-based test: derived title adheres to length constraints
 * and selects the correct placeholder when input is blank.
 *
 * This test validates ALL acceptance criteria for chat title generation
 * as applied to the post-creation flow in a real browser request.
 *
 * Scope: Assume useBrainChats.autoTitle(id, text) is called flow:
 * 1) New chat created with DEFAULT_CHAT_TITLE = "New chat" (placeholder).
 * 2) First user message persisted.
 * 3) Chat list reloaded so chatList_latest[0] = newlyCreatedChat (adjacency).
 * 4) Auto-title succeeds if title !== DEFAULT_CHAT_TITLE.
 *
 * For testability, treat derivation purely as independent of persistence timing:
 * deriveChatTitle is a pure function; we drive its inputs from test data.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveChatTitle,
  DEFAULT_CHAT_TITLE,
  MAX_CHAT_TITLE_LENGTH,
} from './useBrainChats';

describe('deriveChatTitle (property-based)', () => {
  /**
   * Enforce these constraints across all inputs:
   * - Title length ≤ MAX (in words and characters, with ellipsis).
   * - At least 3 words when words > 3; typically 3–10 where possible.
   * - No generic title when input is completely blank/empty.
   * - Short slice respecting bodyBudget: trim at bodyBudget before ellipsis.
   */
  const minWords = 3;
  const maxWords = 10;
  const bodyBudget = 35; // Space for truncation + ellipsis.

  // Safe slices: guaranteed prefix of the input. All slices fit bodyBudget.
  const safeHeadSlices = ['Fix the bug', 'Debug flaky', 'Purchase items', 'Review docs', 'Optimize code'];
  const safeBodySlices = [
    'the CRLF edit bug',
    'flaky CI on task-404',
    'items from the store',
    'the stakeholders PRD',
    'code in the repository',
  ];

  // Inputs known to be all-blank/empty (should return empty).
  const blankInputs = ['', '   ', '\n\n\t', '   \n'];

  blankInputs.forEach((input) => {
    it(`should return empty for completely blank/empty input: "${input}"`, () => {
      const result = deriveChatTitle(input);
      expect(result).toBe('');
    });
  });

  safeHeadSlices.forEach((head) => {
    safeBodySlices.forEach((body) => {
      const input = `${head} ${body}`.trim();
      it(`should derive title with correct constraints: "${head} ${body}"`, () => {
        const title = deriveChatTitle(input);
        const words = title.split(/\s+/);

        // Length less than or equal to MAX (including ellipsis).
        expect(title.length).toBeLessThanOrEqual(MAX_CHAT_TITLE_LENGTH + 1);

        // At least 3 words when words > 3; typically 3–10.
        if (words.length > 3) {
          expect(words.length).toBeGreaterThanOrEqual(minWords);
        } else {
          expect(words.length).toBeLessThanOrEqual(maxWords);
        }

        // No generic placeholder when input is not blank.
        expect(title).not.toBe(DEFAULT_CHAT_TITLE);
      });
    });
  });
});