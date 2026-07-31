/**
 * Drizzle schema — the barrel.
 *
 * The definitions live in `./schema/<context>.ts`, one file per bounded
 * context. This file re-exports all of them so the ~390 modules that
 * `import { … } from '…/database/schema'` — and `drizzle.config.ts` — keep
 * working unchanged.
 *
 * Add a NEW table to the context file it belongs to, not here.
 */

export * from './schema/common';
export * from './schema/identity';
export * from './schema/billing';
export * from './schema/work';
export * from './schema/pmo';
export * from './schema/runtime';
export * from './schema/llm';
export * from './schema/brain';
export * from './schema/delivery';
export * from './schema/collaboration';
export * from './schema/commerce';
export * from './schema/governance';
export * from './schema/platform';
export * from './schema/deadlines';
