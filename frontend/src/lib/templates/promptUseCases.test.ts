import { describe, expect, it } from 'vitest';
import {
  C_SUITE_CANVAS_USE_CASES,
  C_SUITE_USE_CASE_IDS,
  executiveCanvasPrompt,
  executiveUseCaseFromPrompt,
  resolveExecutiveUseCaseId,
} from './promptUseCases';

const DECK = C_SUITE_CANVAS_USE_CASES.find((item) => item.id === 'scratchpad.create_deck')!;

describe('executiveUseCaseFromPrompt', () => {
  it('reads the contract out of a prompt the picker composed', () => {
    // The writer and the reader are two halves of one fact, so the test drives
    // the reader with what the WRITER actually produces rather than a literal.
    const prompt = executiveCanvasPrompt(DECK)!;
    expect(executiveUseCaseFromPrompt(prompt)?.id).toBe('scratchpad.create_deck');
  });

  it('returns null for an ordinary prompt', () => {
    expect(executiveUseCaseFromPrompt('Turn this chart into a one-page board update')).toBeNull();
  });

  it('reads every use case back from its own composed prompt', () => {
    for (const useCase of C_SUITE_CANVAS_USE_CASES) {
      expect(executiveUseCaseFromPrompt(executiveCanvasPrompt(useCase)!)?.id).toBe(useCase.id);
    }
  });
});

describe('resolveExecutiveUseCaseId', () => {
  it('takes the exact argument when it is spelled correctly', () => {
    expect(resolveExecutiveUseCaseId({ useCaseId: 'scratchpad.create_deck' })).toBe('scratchpad.create_deck');
  });

  it('recovers the id from a MISTYPED key — the bug this exists for', () => {
    // Observed in production 2026-08-16: the model emitted `useCas1eId` with a
    // perfectly correct value, the lookup missed, and the turn died having
    // created nothing. The value space is a closed enum of 48 dotted ids, so a
    // value that IS one of them can only have been meant as the use case.
    expect(resolveExecutiveUseCaseId({ useCas1eId: 'scratchpad.create_deck' })).toBe('scratchpad.create_deck');
  });

  it('falls back to the contract the turn is running when the args carry nothing', () => {
    expect(resolveExecutiveUseCaseId({}, 'scratchpad.create_deck')).toBe('scratchpad.create_deck');
    expect(resolveExecutiveUseCaseId(null, 'finance.runway.snapshot')).toBe('finance.runway.snapshot');
  });

  it('prefers the argument over the in-flight contract', () => {
    // A turn can legitimately call the tool for a DIFFERENT use case than the
    // one its prompt declared; the fallback is a last resort, not an override.
    expect(resolveExecutiveUseCaseId({ useCaseId: 'crm.pipeline.summary' }, 'scratchpad.create_deck'))
      .toBe('crm.pipeline.summary');
  });

  it('never invents an id from a value that is not one', () => {
    expect(resolveExecutiveUseCaseId({ useCaseId: 'scratchpad.make_me_a_deck' })).toBeNull();
    expect(resolveExecutiveUseCaseId({ note: 'create a deck please' })).toBeNull();
    expect(resolveExecutiveUseCaseId({}, 'not.a.real.id')).toBeNull();
    expect(resolveExecutiveUseCaseId(undefined)).toBeNull();
  });

  it('ignores a non-id string sitting beside the real one', () => {
    expect(resolveExecutiveUseCaseId({ note: 'hello', useCas1eId: 'governance.snapshot' }))
      .toBe('governance.snapshot');
  });
});

describe('the id set', () => {
  it('covers every use case, so the tool enum and the resolver agree', () => {
    expect(C_SUITE_USE_CASE_IDS.size).toBe(C_SUITE_CANVAS_USE_CASES.length);
    for (const useCase of C_SUITE_CANVAS_USE_CASES) {
      expect(C_SUITE_USE_CASE_IDS.has(useCase.id!)).toBe(true);
    }
  });
});
