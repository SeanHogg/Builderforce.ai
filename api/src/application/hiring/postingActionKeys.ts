/**
 * The connector action keys the hiring use cases address boards by — one place, so the
 * distribute use case and the store that reads its rows cannot disagree on a spelling
 * (and the store need not import the use case that imports it).
 */

/** The action every hiring board publishes with — one key across the category. */
export const PUBLISH_POSTING_ACTION = 'create_posting';

/** Migration 1328's index: one confirmed board job belongs to one posting. A unique
 *  violation is translated only when it names THIS index. */
export const BOARD_JOB_UNIQUE_INDEX = 'uq_job_posting_distributions_board_job';

/** The table's original per-person index: one application per (posting, candidate). */
export const CANDIDATE_APPLICATION_UNIQUE_INDEX = 'uq_job_applications_candidate';

/** The actions that list the people who applied, in the order they are preferred. Lever
 *  calls its applicants "opportunities"; everyone else says "applications". */
export const LIST_APPLICANTS_ACTIONS = ['list_applications', 'list_opportunities'] as const;
