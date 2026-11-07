/**
 * Numeric helpers shared across metrics/insights modules. They live in
 * `@builderforce/score-math` so the shared résumé analysis (also run by the web client)
 * and the API's scorers use ONE definition; this is the API's stable import path.
 */
export * from '@builderforce/score-math';
