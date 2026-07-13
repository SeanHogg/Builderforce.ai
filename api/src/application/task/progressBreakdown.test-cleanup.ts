/**
 * Cleanup file to identify and document gaps in test coverage.
 *
 * Current status:
 * - FR-1 (breakdown calculation logic): Mostly covered in progressBreakdown.test.ts
 * - FR-2 (aggregation & normalization): NOT APPLICABLE - helpers not exposed in implementation
 * - FR-3 (endpoint tests): TODO - require route implementation first
 * - FR-4 (edge cases): Partially covered
 * - FR-5 (test infrastructure): Partially covered
 *
 * The route tests in taskRoutes.progressBreakdown.test.ts are invalid and need to be removed
 * until the endpoint exists and proper testing infrastructure is defined.
 *
 * Priority tasks:
 * 1. Decide whether FR-2 helpers should be added or remvoed from PRD
 * 2. Implement GET /progress/breakdown endpoint if needed
 * 3. Update route tests to use proper testing infrastructure (not Playwright)
 * 4. Add missing edge case tests to satisfy FR-4
 */

console.log('This file documents test coverage gaps for PRD #669');