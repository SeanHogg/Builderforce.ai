/**
 * Money units — the ONE definition of the millicents↔USD conversion.
 *
 * Agent LLM spend is stored in **millicents** (1/100000 USD) across the schema
 * (see migration 0097) so sub-cent per-call costs don't round to zero. Every USD
 * projection divides by {@link MILLICENTS_PER_USD} (or uses {@link millicentsToUsd}).
 * The factor is declared in `@builderforce/spend-contract` (`cost.ts`), beside the cost
 * rule a device prices its own calls with, and re-exported here for the api's modules.
 */

export { MILLICENTS_PER_USD, millicentsToUsd } from '@builderforce/spend-contract';
