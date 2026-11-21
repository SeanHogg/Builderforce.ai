import { describe, expect, it } from 'vitest';
import { chatAsks, isPersonTurn, personMarkedRunTurns } from './chatAsks';
import { asksToShip, publishHold } from './publishHold';
import { declinesShipping, unquotedText } from '../selfReviewShip';
import { INJECTED_TURN_META_KEY, injectedTurnIdsOf, isInjectedTurnMetadata, withInjectedMeta } from '../injectedTurn';
import type { ChatCompletionMessage } from '../streamChatCompletion';

// VS Code chat #157440: the editor's Resume continuation ("Continue the task that was interrupted…") is a user-role row
// that quotes a sub-agent's brief verbatim — that brief ended "Do not commit." Every user row was marked a PERSON turn,
// so the quote set the chat's publish hold. The continuation is now saved marked injected and never marked a person turn.

const BRIEF = 'Implement the measure page.\nDo not commit.';
const RESUME = [
  'Continue the task that was interrupted when the editor closed.',
  'The original request, verbatim:\n> For all the items that are incomplete, create associated tickets to this chat',
  `Sub-agents:\nSub-agents your interrupted run had started: 1.\n- @dev-1 (Developer; started by you): interrupted — not resumed; re-spawn or do it yourself. Its brief was:\n${BRIEF.split('\n').map((l) => `    ${l}`).join('\n')}`,
  "Continue only this chat's task above. Check what is already done before redoing it, and do not pick up any other session's work.",
].join('\n\n');

describe('injected turn metadata', () => {
  it('marks, reads (string or object) and lists injected rows', () => {
    const meta = JSON.stringify(withInjectedMeta({ attachments: [] }));
    expect(isInjectedTurnMetadata(meta)).toBe(true);
    expect(isInjectedTurnMetadata({ [INJECTED_TURN_META_KEY]: true })).toBe(true);
    expect(isInjectedTurnMetadata(null)).toBe(false);
    expect(isInjectedTurnMetadata('{"midTurn":true}')).toBe(false);
    expect(isInjectedTurnMetadata('not json injected')).toBe(false);
    expect(injectedTurnIdsOf([
      { id: 1, role: 'user', metadata: null },
      { id: 2, role: 'user', metadata: meta },
      { id: 3, role: 'assistant', metadata: meta },
    ])).toEqual([2]);
  });
});

describe('regression: chat #157440 — a resume turn quoting "Do not commit" sets no publish hold', () => {
  it('regression: an injected resume turn (the triggering turn) is not a person turn and sets no hold', () => {
    const { turn } = personMarkedRunTurns({ userTurn: RESUME, userTurnMessageId: 2319, injectedTurnIds: [2319] });
    expect(turn && isPersonTurn(turn)).toBe(false);
    expect(publishHold([turn!])).toBeNull();
    expect(chatAsks([turn!])).toEqual([]);
  });

  it('regression: an injected resume row in the persisted seed sets no hold either', () => {
    const seed: ChatCompletionMessage[] = [
      { role: 'user', content: 'Review the Measure.md file' },
      { role: 'assistant', content: 'Done.' },
      { role: 'user', content: RESUME },
    ];
    const opening = personMarkedRunTurns({ seed, seedIds: [10, 11, 12], injectedTurnIds: [12], userTurn: 'go on', userTurnMessageId: 13 });
    expect(opening.seed!.map((m) => m.role === 'user' && isPersonTurn(m))).toEqual([true, false, false]);
    expect(publishHold([...opening.seed!, opening.turn!])).toBeNull();
  });

  it('a real person "do not commit" still sets the hold', () => {
    const { turn } = personMarkedRunTurns({ userTurn: 'Fix the parser, but do not commit until I review.', userTurnMessageId: 5, injectedTurnIds: [4] });
    expect(publishHold([turn!])?.text).toMatch(/do not commit/i);
  });

  it('without injected ids every row stays a person turn (unchanged behaviour)', () => {
    const { turn } = personMarkedRunTurns({ userTurn: RESUME, userTurnMessageId: 2319 });
    expect(isPersonTurn(turn!)).toBe(true);
    expect(publishHold([turn!])).not.toBeNull();
  });
});

describe('the ship-intent scan ignores quoted blocks', () => {
  it('a quoted "Do not commit" is no decline; the same words unquoted are', () => {
    expect(declinesShipping('Please continue.\n> Do not commit.')).toBe(false);
    expect(declinesShipping('Please continue.\nDo not commit.')).toBe(true);
    expect(unquotedText('a\n> b\n  > c\nd')).toBe('a\nd');
  });

  it('a quoted ship order never lifts a hold', () => {
    expect(asksToShip('> commit and push')).toBe(false);
    expect(asksToShip('commit and push')).toBe(true);
  });
});
