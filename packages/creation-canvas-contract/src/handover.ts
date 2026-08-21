/**
 * THE HANDOVER — the seam where the hiring funnel stops being a funnel and becomes a
 * person on the payroll.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * `HIRING_OBJECT_KINDS` owns the funnel and `PEOPLE_OBJECT_KINDS` owns the employment
 * relationship, and both headers already NAME the transition between them: `people.ts`
 * says "the handover between them is an `offer` becoming an `employee`", and its
 * `employeeLifecycle` comment says a lifecycle "is what an accepted offer becomes on day
 * one". Neither sentence was true. Nothing performed the transition, so the product
 * shipped two funnels that stopped next to each other: a signed offer sat on the board as
 * a signed offer forever, and somebody re-typed the same person into an `employee` card
 * with no link back to the offer that hired them.
 *
 * ── WHY IT IS DECLARED HERE AND NOT IN EITHER VOCABULARY ─────────────────────────
 * A handover belongs to NEITHER bounded context: it is the contract BETWEEN them. Putting
 * the field mapping in `hiringObjects.ts` would make the recruiter's vocabulary author HR
 * records; putting it in `peopleObjects.ts` would make the HR vocabulary read the
 * recruiter's fields. Both are the cross-context import that PRD 20 §3 refuses. So the
 * seam is declared once, in the package both vocabularies already depend on, as a pure
 * function over plain records — no React, no store, no table — which is what lets the
 * canvas action, its test and any future server-side hire read ONE mapping.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────────
 * It invents nothing. Every field it writes is copied from the offer, the candidate or
 * the posting already on the board, and a field with no source is left EMPTY so the gap
 * is visible — an `employee` whose department was guessed reconciles against a
 * `headcountPlan` that never approved them. And it refuses outright unless the offer was
 * actually signed: an employment record that begins from an unsigned offer is a record of
 * something that did not happen.
 */

/** One declared transition between two vocabularies. */
export interface VocabularyHandover {
  /** Stable id, used by the test that proves the declaration and the seam agree. */
  id: string;
  /** The kind the handover is invoked ON. */
  from: string;
  /** The action the source kind advertises for it. */
  action: string;
  /** The kinds it creates, in the order it creates them. */
  produces: readonly string[];
  /** The field every produced object carries back to its source. ONE name, so
   *  idempotence is one lookup rather than a matching heuristic per kind. */
  backReference: string;
}

/**
 * `offer` → `employee` + `employeeLifecycle`.
 *
 * Two objects and not one, because they answer different questions and outlive each other
 * differently: the `employee` is the relationship (and carries the six-year retention
 * floor `RETENTION_RULES` declares for it), while the `employeeLifecycle` is the dated
 * onboarding work that is finished within a quarter and is only evidence afterwards.
 */
export const OFFER_TO_EMPLOYMENT_HANDOVER: VocabularyHandover = {
  id: 'offerToEmployment',
  from: 'offer',
  action: 'hire',
  produces: ['employee', 'employeeLifecycle'],
  backReference: 'offerRef',
};

/** Every declared handover. One entry today; the list is what stops the second one being
 *  written as a second mechanism. */
export const VOCABULARY_HANDOVERS: readonly VocabularyHandover[] = [OFFER_TO_EMPLOYMENT_HANDOVER];

/**
 * The onboarding plan a hire starts from, as DATA.
 *
 * `dueOffset` is days relative to the start date, negative meaning before it — the same
 * convention `employeeLifecycle.steps` documents. The six steps are the four categories
 * that actually get missed (statutory checks, payroll/benefits, equipment, system access)
 * plus the two that decide whether the hire lands: somebody owning the first week, and a
 * probation review that is booked rather than remembered.
 *
 * `key` and not a label, because a step title is content a person reads and this package
 * has no catalogs. The caller resolves each key through its own i18n namespace
 * (`creationCanvas.hiring.onboardingStep.*`), so a German workspace gets a German
 * checklist from the same declaration — and so a step cannot be added here without a
 * translation being added with it.
 */
export const ONBOARDING_STEP_BLUEPRINT = [
  /** Before day one, without exception: an unevidenced right to work is the one
   *  onboarding failure that is a criminal matter rather than an inconvenience. */
  { key: 'rightToWork', dueOffset: -5 },
  { key: 'payrollEnrolment', dueOffset: -3 },
  { key: 'equipment', dueOffset: -3 },
  { key: 'systemAccess', dueOffset: -1 },
  { key: 'managerIntroduction', dueOffset: 0 },
  { key: 'probationReview', dueOffset: 30 },
] as const;

export type OnboardingStepKey = typeof ONBOARDING_STEP_BLUEPRINT[number]['key'];

/**
 * How a posting's employment type reads on an employment record.
 *
 * The two vocabularies genuinely use different words — `jobPosting.employmentType` is
 * advertised to candidates ("permanent", "fixed-term") and `employee.employment` mirrors
 * `people_employees.employment` ("full_time", "contract"). Reconciling them is what this
 * module is for; carrying the advertised word onto the employment record would make the
 * HR domain hold a value its own column does not accept.
 */
const EMPLOYMENT_TYPE_TO_BASIS: Readonly<Record<string, string>> = {
  permanent: 'full_time',
  'full-time': 'full_time',
  fulltime: 'full_time',
  'part-time': 'part_time',
  parttime: 'part_time',
  'fixed-term': 'contract',
  fixedterm: 'contract',
  contract: 'contract',
  contractor: 'contract',
  internship: 'intern',
  intern: 'intern',
};

/** The employment basis a posting's advertised type maps to, or `''` when it names none. */
export function employmentBasisFor(employmentType: unknown): string {
  const key = String(employmentType ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return EMPLOYMENT_TYPE_TO_BASIS[key] ?? '';
}

/** The objects the handover reads. All three come off the board; only `offer` is required. */
export interface EmploymentHandoverSource {
  offer: Readonly<Record<string, unknown>>;
  /** The `candidate` the offer names, when one is on the board. */
  candidate?: Readonly<Record<string, unknown>> | null;
  /** The `jobPosting` the offer or the candidate names, when one is on the board. */
  posting?: Readonly<Record<string, unknown>> | null;
  /** Resolves an {@link ONBOARDING_STEP_BLUEPRINT} key to the reader's language. */
  stepLabel: (key: OnboardingStepKey) => string;
  /** How the produced cards refer to the offer they came from — an object id, so the back
   *  reference survives the offer being retitled. */
  offerRef: string;
}

export interface EmploymentHandover {
  /** Fields for the `employee` card. */
  employee: Record<string, unknown>;
  /** Fields for the onboarding `employeeLifecycle` card. */
  lifecycle: Record<string, unknown>;
  /** How both cards refer to the person, so the caller can title them. */
  personRef: string;
}

/**
 * Why this offer cannot be hired from yet, or `null` when it can.
 *
 * A code rather than a sentence: the caller owns the wording — and must, because the
 * wording is localized and this package has no catalogs — and the codes are what the test
 * asserts on. Ordered by which gap a person should fix first.
 */
export type HandoverBlocker = 'notSigned' | 'noPerson' | 'noStartDate';

const text = (value: unknown): string => String(value ?? '').trim();

/** True when the offer carries real evidence it was signed, rather than an asserted state. */
export function offerIsSigned(offer: Readonly<Record<string, unknown>>): boolean {
  return text(offer.signatureState).toLowerCase() === 'signed' || text(offer.signedAt) !== '';
}

/** How the person is identified on both produced cards: the work email if the offer has
 *  one, else the candidate's own name. Never an invented identifier. */
export function handoverPersonRef(source: Pick<EmploymentHandoverSource, 'offer' | 'candidate'>): string {
  return text(source.offer.candidateEmail)
    || text(source.candidate?.title)
    || text(source.offer.candidateRef);
}

/** {@link HandoverBlocker}, or `null` when the handover may proceed. */
export function employmentHandoverBlocker(
  source: Pick<EmploymentHandoverSource, 'offer' | 'candidate'>,
): HandoverBlocker | null {
  if (!offerIsSigned(source.offer)) return 'notSigned';
  if (!handoverPersonRef(source)) return 'noPerson';
  // The start date is the anchor every lifecycle step is dated from. Without it the plan
  // has no due dates at all, which is the same as having no plan.
  if (!text(source.offer.startDate)) return 'noStartDate';
  return null;
}

/**
 * The employment records a signed offer becomes.
 *
 * Throws on a blocked offer rather than returning a half-populated pair: a caller that
 * forgets to check {@link employmentHandoverBlocker} must fail loudly, not quietly write
 * an employee with no start date.
 */
export function planEmploymentHandover(source: EmploymentHandoverSource): EmploymentHandover {
  const blocker = employmentHandoverBlocker(source);
  if (blocker) throw new Error(`Offer cannot be hired from: ${blocker}`);

  const { offer, candidate, posting } = source;
  const personRef = handoverPersonRef(source);
  const startedAt = text(offer.startDate);
  const jobTitle = text(posting?.title) || text(offer.title);
  const owner = text(posting?.hiringManager);
  const skills = candidate?.skills;

  const employee: Record<string, unknown> = {
    personRef,
    jobTitle,
    // `department` and `band` are DELIBERATELY ABSENT. Both have to match something else
    // on the board — a `headcountPlan`'s team names, a `compBand`'s title — and neither
    // the offer nor the posting carries either, so a value here would be a guess that
    // reconciles against a plan that never approved this hire.
    employment: employmentBasisFor(posting?.employmentType),
    location: text(posting?.location) || text(candidate?.location),
    startedAt,
    competencies: Array.isArray(skills) ? [...(skills as unknown[])] : [],
    // The employment record is restricted by default for its kind; stating it on the card
    // means the level travels with a card that is later duplicated or exported.
    confidentiality: 'restricted',
    [OFFER_TO_EMPLOYMENT_HANDOVER.backReference]: source.offerRef,
  };

  const lifecycle: Record<string, unknown> = {
    direction: 'onboarding',
    personRef,
    anchorDate: startedAt,
    steps: ONBOARDING_STEP_BLUEPRINT.map((step) => ({
      step: source.stepLabel(step.key),
      owner,
      dueOffset: String(step.dueOffset),
      status: 'todo',
      evidence: '',
    })),
    confidentiality: 'restricted',
    [OFFER_TO_EMPLOYMENT_HANDOVER.backReference]: source.offerRef,
  };

  return { employee, lifecycle, personRef };
}

/**
 * The `employee` already hired from this offer, if there is one.
 *
 * The idempotence check, written once. Hiring twice from one offer must not create a
 * second employment record for the same person — the failure mode that makes a payroll
 * export double-count somebody — and matching on a NAME would fail the moment two people
 * share one. Matching on the back reference is exact by construction.
 */
export function employeeHiredFrom(
  employees: readonly Readonly<Record<string, unknown>>[],
  offerRef: string,
): Readonly<Record<string, unknown>> | null {
  const ref = text(offerRef);
  if (!ref) return null;
  return employees.find((employee) => text(employee[OFFER_TO_EMPLOYMENT_HANDOVER.backReference]) === ref) ?? null;
}
