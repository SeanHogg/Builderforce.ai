import { describe, expect, it } from 'vitest';
import {
  employeeHiredFrom,
  employmentBasisFor,
  employmentHandoverBlocker,
  ONBOARDING_STEP_BLUEPRINT,
  OFFER_TO_EMPLOYMENT_HANDOVER,
  offerIsSigned,
  planEmploymentHandover,
  VOCABULARY_HANDOVERS,
  type OnboardingStepKey,
} from '@builderforce/creation-canvas-contract';
import en from '@/i18n/messages/en.json';
import { HIRING_OBJECT_SPECS } from './hiringObjects';
import { PEOPLE_OBJECT_SPECS } from './peopleObjects';
import './specObjectSets';
import { specMutableFields, specReadableFields } from './specObjects';

const SIGNED_OFFER = {
  kind: 'offer',
  title: 'Offer — Senior React Engineer',
  candidateRef: 'cand-1',
  postingRef: 'post-1',
  candidateEmail: 'ada@example.com',
  startDate: '2026-09-01',
  signatureState: 'signed',
  signedAt: '2026-08-11T09:00:00.000Z',
};
const CANDIDATE = { kind: 'candidate', title: 'Ada Okafor', location: 'Lagos', skills: ['React', 'TypeScript'] };
const POSTING = {
  kind: 'jobPosting', title: 'Senior React Engineer',
  location: 'Berlin — hybrid, 2 days', employmentType: 'permanent', hiringManager: 'Sam Ito',
};

const stepLabel = (key: OnboardingStepKey) => `step:${key}`;
const plan = (over: Record<string, unknown> = {}) => planEmploymentHandover({
  offer: { ...SIGNED_OFFER, ...over }, candidate: CANDIDATE, posting: POSTING,
  offerRef: 'offer-1', stepLabel,
});

describe('the handover is DECLARED', () => {
  it('names the transition both vocabularies only described in prose', () => {
    expect(VOCABULARY_HANDOVERS).toContain(OFFER_TO_EMPLOYMENT_HANDOVER);
    expect(OFFER_TO_EMPLOYMENT_HANDOVER.from).toBe('offer');
    expect(OFFER_TO_EMPLOYMENT_HANDOVER.produces).toEqual(['employee', 'employeeLifecycle']);
  });

  it('is advertised by the kind it is invoked on', () => {
    // The whole defect this closes: an act described in a header and advertised nowhere.
    const offer = HIRING_OBJECT_SPECS.find((spec) => spec.kind === OFFER_TO_EMPLOYMENT_HANDOVER.from);
    expect(offer?.actions).toContain(OFFER_TO_EMPLOYMENT_HANDOVER.action);
  });

  it('gives every produced kind somewhere to record where it came from', () => {
    for (const kind of OFFER_TO_EMPLOYMENT_HANDOVER.produces) {
      const spec = PEOPLE_OBJECT_SPECS.find((entry) => entry.kind === kind);
      expect(spec?.fields.map((field) => field.name)).toContain(OFFER_TO_EMPLOYMENT_HANDOVER.backReference);
      // Readable so a person can answer "on what terms was this agreed"; never writable,
      // because a hand-typed reference is what makes the idempotence check miss.
      expect(specReadableFields(kind)).toContain(OFFER_TO_EMPLOYMENT_HANDOVER.backReference);
      expect(specMutableFields(kind)).not.toContain(OFFER_TO_EMPLOYMENT_HANDOVER.backReference);
    }
  });
});

describe('what it refuses', () => {
  it('will not hire from an offer nobody signed', () => {
    expect(offerIsSigned({ signatureState: 'sent' })).toBe(false);
    expect(employmentHandoverBlocker({ offer: { ...SIGNED_OFFER, signatureState: 'sent', signedAt: '' } })).toBe('notSigned');
  });

  it('accepts a signature evidenced by either the state or the instant', () => {
    expect(offerIsSigned({ signatureState: 'signed' })).toBe(true);
    expect(offerIsSigned({ signedAt: '2026-08-11T09:00:00.000Z' })).toBe(true);
  });

  it('will not produce an employment record about nobody', () => {
    expect(employmentHandoverBlocker({ offer: { ...SIGNED_OFFER, candidateRef: '', candidateEmail: '' } })).toBe('noPerson');
  });

  it('will not produce an onboarding plan with no anchor to date its steps from', () => {
    expect(employmentHandoverBlocker({ offer: { ...SIGNED_OFFER, startDate: '' } })).toBe('noStartDate');
  });

  it('throws rather than half-writing when a caller skips the check', () => {
    expect(() => plan({ signatureState: 'sent', signedAt: '' })).toThrow(/notSigned/);
  });
});

describe('what it carries across', () => {
  it('reads the employment record out of the offer, the candidate and the posting', () => {
    const { employee, personRef } = plan();
    expect(personRef).toBe('ada@example.com');
    expect(employee.jobTitle).toBe('Senior React Engineer');
    expect(employee.location).toBe('Berlin — hybrid, 2 days');
    expect(employee.startedAt).toBe('2026-09-01');
    expect(employee.competencies).toEqual(['React', 'TypeScript']);
    expect(employee.offerRef).toBe('offer-1');
    expect(employee.confidentiality).toBe('restricted');
  });

  it('translates the advertised employment type into the basis the HR domain accepts', () => {
    expect(employmentBasisFor('permanent')).toBe('full_time');
    expect(employmentBasisFor('Fixed-Term')).toBe('contract');
    expect(employmentBasisFor('internship')).toBe('intern');
    // A word neither vocabulary declares leaves the field EMPTY rather than guessing.
    expect(employmentBasisFor('seasonal')).toBe('');
    expect(plan().employee.employment).toBe('full_time');
  });

  it('invents nothing the funnel does not carry', () => {
    const { employee } = plan();
    // `department` and `band` have to reconcile against a headcountPlan and a compBand,
    // and neither the offer nor the posting holds them. An absent field is the gap
    // showing; a guessed one is a plan that never approved this hire.
    expect(employee.department).toBeUndefined();
    expect(employee.band).toBeUndefined();
  });

  it('falls back to the candidate rather than inventing an identifier', () => {
    const withoutEmail = planEmploymentHandover({
      offer: { ...SIGNED_OFFER, candidateEmail: '' }, candidate: CANDIDATE, posting: POSTING,
      offerRef: 'offer-1', stepLabel,
    });
    expect(withoutEmail.personRef).toBe('Ada Okafor');
  });

  it('dates every onboarding step from the start date, before it where it belongs', () => {
    const steps = plan().lifecycle.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(ONBOARDING_STEP_BLUEPRINT.length);
    expect(plan().lifecycle.anchorDate).toBe('2026-09-01');
    expect(plan().lifecycle.direction).toBe('onboarding');
    // Right to work is the one that must be evidenced BEFORE day one.
    expect(steps[0]).toMatchObject({ step: 'step:rightToWork', dueOffset: '-5', status: 'todo' });
    expect(steps.every((step) => step.owner === 'Sam Ito')).toBe(true);
  });
});

describe('idempotence', () => {
  it('finds the employee already hired from an offer by its back reference, not by name', () => {
    const employees = [
      { kind: 'employee', personRef: 'ada@example.com', offerRef: 'offer-1' },
      { kind: 'employee', personRef: 'ada@example.com', offerRef: 'offer-2' },
    ];
    expect(employeeHiredFrom(employees, 'offer-2')?.personRef).toBe('ada@example.com');
    expect(employeeHiredFrom(employees, 'offer-2')?.offerRef).toBe('offer-2');
    expect(employeeHiredFrom(employees, 'offer-3')).toBeNull();
    // An offer with no id can never match, or every unreferenced employee would.
    expect(employeeHiredFrom(employees, '')).toBeNull();
  });
});

describe('the checklist is content, so it is localized', () => {
  it('has an English title for every declared step', () => {
    const catalog = en.creationCanvas.hiring.onboardingStep as Record<string, string>;
    for (const step of ONBOARDING_STEP_BLUEPRINT) {
      expect(catalog[step.key], `missing onboardingStep.${step.key}`).toBeTruthy();
    }
  });
});

describe('the résumé attaches to a candidate', () => {
  it('gives the candidate somewhere to name the document that evidences them', () => {
    // The gap: `canvas_screen_resumes` scored `resume` objects while the funnel's own
    // person object sat unlinked beside them.
    expect(specMutableFields('candidate')).toContain('resumeRef');
  });

  it('lets the ranking name the person and not only the document', () => {
    const ranked = HIRING_OBJECT_SPECS.find((spec) => spec.kind === 'shortlist')
      ?.fields.find((field) => field.name === 'ranked');
    expect(ranked?.columns).toContain('candidateRef');
  });

  it('joins the loop and the scorecard to the same person', () => {
    for (const kind of ['interviewLoop', 'scorecard', 'offer']) {
      expect(specMutableFields(kind), kind).toContain('candidateRef');
    }
  });
});
