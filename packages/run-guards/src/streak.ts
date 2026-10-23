/**
 * Consecutive identical calls ({@link callFingerprint}) at which a back-to-back streak
 * becomes a verdict on its own. Two in a row is a retry; three is the model asking the
 * same question a third time after hearing the same answer twice, whatever the rest of
 * the run looks like. Shared by the post-hoc run report and the live guards.
 */
export const BACK_TO_BACK_AT = 3;
