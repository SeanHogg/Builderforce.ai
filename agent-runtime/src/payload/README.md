/**
 * Payload Generation Module
 *
 * This module provides a centralized, declarative way to construct outbound payloads
 * from internal data sources using configurable business rules.
 *
 * ## Quick Start
 *
 * ```ts
 * import { createPayloadGenerator } from './payload/index.ts';
 *
 * const def = {
 *   id: 'user.v1',
 *   name: 'User Payload',
 *   fields: [
 *     { name: 'id', source: { path: 'user.id', required: true } },
 *     {
 *       name: 'fullName',
 *       source: { path: 'user.firstName' },
 *       transform: { derivedFunction: 'fullName' }
 *     }
 *   ],
 *   schema: {
 *     required: ['id'],
 *     properties: { id: { type: 'string' }, fullName: { type: 'string' } }
 *   }
 * };
 *
 * const gen = createPayloadGenerator(def);
 * const result = gen.generate({ user: { id: 'u-123', firstName: 'Alice' } });
 *
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 *
 * ## Features
 *
 * - **FR-1 Data Ingestion**: Accept structured context with optional async lookups
 * - **FR-2 Field Mapping**: Direct, nested, flattened, and aliased field paths
 * - **FR-3 Business Rules**: Declarative type coercion, conditions, derived fields, enum mapping
 * - **FR-4 Payload Assembly**: Required/optional fields with source and schema defaults
 * - **FR-5 Validation**: Structured schema validation with multi-version support
 * - **FR-6 Observability**: Structured logs and typed Result<success, errors>
 * - **FR-7 Extensibility**: New payload types via Configuration without core engine changes
 *
 * ## Business Rulesets
 *
 * Rulesets are defined in `business-rules.json` and can be referenced by payload definitions.
 *
 * ## Modules
 *
 * - `engine.ts` — Core generation pipeline (Plan → Resolve → Transform → Validate)
 * - `types.ts` — TypeScript type definitions
 * - `ruleset.ts` — Ruleset catalog loading and resolution
 * - `index.ts` — Public API and helper functions
 * - `*.test.ts` — Unit and integration tests
 */

export * from './index.ts';