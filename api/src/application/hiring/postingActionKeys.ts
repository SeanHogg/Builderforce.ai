/**
 * The connector action keys the hiring use cases address boards by — one place, so the
 * distribute use case and the store that reads its rows cannot disagree on a spelling
 * (and the store need not import the use case that imports it).
 */

/** The action every hiring board publishes with — one key across the category. */
export const PUBLISH_POSTING_ACTION = 'create_posting';

/** The actions that list the people who applied, in the order they are preferred. Lever
 *  calls its applicants "opportunities"; everyone else says "applications". */
export const LIST_APPLICANTS_ACTIONS = ['list_applications', 'list_opportunities'] as const;
