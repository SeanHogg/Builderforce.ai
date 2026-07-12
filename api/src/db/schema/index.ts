/**
 * Database Schema
 * 
 * Central export point for all database schemas.
 */

import { relations } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { stakeholderMaps } from './stakeholderMaps.js';

export * from './tenants.js';
export * from './stakeholderMaps.js';

// Export relations
export { relations };

// Compose relations
export const tenantRelations = relations(tenants, (many) => ({
  stakeholderMaps: many(stakeholderMaps),
}));

export const stakeholderMapRelations = relations(stakeholderMaps, (one) => ({
  tenant: one(tenants),
}));