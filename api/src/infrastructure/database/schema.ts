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

export * from './schema/kernel';
export * from './schema/identity';
export * from './schema/finance';
export * from './schema/delivery';
export * from './schema/agents';
export * from './schema/canvas';
export * from './schema/commerce';
export * from './schema/governance';
export * from './schema/platform';
export * from './schema/integrations';
export * from './schema/growth';
export * from './schema/hiring';
export * from './schema/people';
export * from './schema/investor';
export * from './schema/revenue';
export * from './schema/support';
export * from './schema/operations';
// The seventeenth seat: entity formation, jurisdiction registration, IP and the
// matters counsel is arguing — plus the co-founder matching that leads to the
// first of them. See `schema/legal.ts`.
export * from './schema/legal';
export * from './schema/search';
