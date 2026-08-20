import { describe, expect, it } from 'vitest';
import {
  C_SUITE_CANVAS_USE_CASES,
  C_SUITE_USE_CASE_IDS,
  executiveCanvasPrompt,
  executiveRequiredTools,
  executiveUseCaseFromPrompt,
  missingRequiredTools,
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

describe('the measurement contract', () => {
  it('requires a deterministic tool for every career answer that carries a number', () => {
    // The failure this closes: a résumé and a posting are both already in the model's
    // context, so "report the match score" is a sentence a language model can answer
    // plausibly and unreproducibly. Every career intent whose output is a MEASUREMENT
    // names the tool that must produce it.
    for (const id of ['career.runway.snapshot', 'career.job.assess', 'career.resume.tailor', 'career.pipeline.review', 'career.interview.prepare', 'career.offer.compare']) {
      const useCase = C_SUITE_CANVAS_USE_CASES.find((entry) => entry.id === id)!;
      expect(executiveRequiredTools(useCase).length, `${id} must name its tool`).toBeGreaterThan(0);
    }
  });

  it('leaves recording what the PERSON did ungated', () => {
    // `career.application.track` writes down where somebody sent an application and
    // when to chase. There is no measurement to fabricate, so a gate would only stand
    // between them and a fact about their own week.
    const track = C_SUITE_CANVAS_USE_CASES.find((entry) => entry.id === 'career.application.track')!;
    expect(executiveRequiredTools(track)).toEqual([]);
  });

  it('names every required tool the way the model sees it', () => {
    // [[prompt-tool-name-contract]] one layer up: a requirement spelled as the internal
    // catalog id (`hr.runway`) can never be satisfied, because the trace carries the
    // ADVERTISED name and so does the model's tool list. That mismatch would make every
    // gated intent permanently unable to author anything.
    for (const useCase of C_SUITE_CANVAS_USE_CASES) {
      for (const tool of executiveRequiredTools(useCase)) {
        expect(tool, `${useCase.id} names ${tool}`).toMatch(/^builtin_[a-z0-9_]+$/);
      }
    }
  });

  it('only gates the use case that declares it', () => {
    expect(executiveRequiredTools(C_SUITE_CANVAS_USE_CASES.find((entry) => entry.id === 'crm.pipeline.summary')!)).toEqual([]);
    expect(executiveRequiredTools(null)).toEqual([]);
    expect(executiveRequiredTools(undefined)).toEqual([]);
  });
});

describe('missingRequiredTools', () => {
  it('reports what has not run', () => {
    expect(missingRequiredTools(['builtin_hr_runway'], [])).toEqual(['builtin_hr_runway']);
    expect(missingRequiredTools(['builtin_hr_runway'], ['builtin_hr_runway'])).toEqual([]);
  });

  it('accepts a name a gateway prefixed with its own server id', () => {
    // A strict compare here fails CLOSED: the turn could never author anything, which
    // is a worse outcome than occasionally accepting a near-match.
    expect(missingRequiredTools(['builtin_hr_runway'], ['mcp.builtin_hr_runway'])).toEqual([]);
    expect(missingRequiredTools(['builtin_hr_runway'], ['server:builtin_hr_runway'])).toEqual([]);
  });

  it('is not satisfied by a different tool from the same namespace', () => {
    expect(missingRequiredTools(['builtin_recruiter_tailor_resume'], ['builtin_recruiter_match_job']))
      .toEqual(['builtin_recruiter_tailor_resume']);
  });

  it('ignores blank entries rather than treating one as a call', () => {
    expect(missingRequiredTools(['builtin_hr_runway'], ['', '   '])).toEqual(['builtin_hr_runway']);
  });
});
