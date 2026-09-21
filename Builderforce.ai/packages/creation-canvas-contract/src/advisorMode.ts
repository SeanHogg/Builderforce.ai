/**
 * Advisor is a MODE on a talent listing, not a people-object kind.
 * Do not add `advisory` (or similar) to PEOPLE_OBJECT_KINDS.
 *
 * Ticket 2527 / PRD 26 P0.
 */

export const ADVISOR_METHODS = ["video", "phone", "email", "in-person"] as const;
export type AdvisorMethod = (typeof ADVISOR_METHODS)[number];

export const ADVISOR_STAGES = ["start", "grow", "exit"] as const;
export type AdvisorStage = (typeof ADVISOR_STAGES)[number];

export const MARKETPLACE_CATEGORY_ADVISORS = "advisors";

export type AdvisorModeFields = {
  availableAsAdvisor: boolean;
  expertise: string[];
  industries: string[];
  languages: string[];
  methods: AdvisorMethod[];
  stages: AdvisorStage[];
  sessionLengthMinutes: number;
  /** Integer in listing currency. 0 = volunteer. */
  price: number;
  location?: string | null;
  confidentialityDefault: string;
};

export function isAdvisorMethod(value: string): value is AdvisorMethod {
  return (ADVISOR_METHODS as readonly string[]).includes(value);
}

export function isAdvisorStage(value: string): value is AdvisorStage {
  return (ADVISOR_STAGES as readonly string[]).includes(value);
}

export type AdvisorModeValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Required-field rules when advisor mode is on.
 * in-person cannot be saved without location; other methods do not require location.
 */
export function validateAdvisorMode(fields: AdvisorModeFields): AdvisorModeValidation {
  if (!fields.availableAsAdvisor) return { ok: true };
  const errors: string[] = [];
  if (!fields.expertise?.length) errors.push("expertise");
  if (!fields.industries?.length) errors.push("industries");
  if (!fields.languages?.length) errors.push("languages");
  if (!fields.methods?.length) errors.push("methods");
  if (!fields.stages?.length) errors.push("stages");
  if (!Number.isFinite(fields.sessionLengthMinutes) || fields.sessionLengthMinutes <= 0) {
    errors.push("sessionLength");
  }
  if (!Number.isInteger(fields.price) || fields.price < 0) errors.push("price");
  if (!fields.confidentialityDefault) errors.push("confidentialityDefault");
  const wantsInPerson = fields.methods?.includes("in-person");
  if (wantsInPerson && !fields.location?.trim()) errors.push("location");
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function isVolunteerPrice(price: number): boolean {
  return price === 0;
}

export function isPublishableAdvisor(fields: AdvisorModeFields): boolean {
  return fields.availableAsAdvisor && validateAdvisorMode(fields).ok;
}
