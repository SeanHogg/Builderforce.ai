/**
 * Payload Generation Module
 * Centralized payload generation with declarative field mapping, business rules,
 * transformation, and validation.
 *
 * Usage:
 *   import { createPayloadGenerator, type PayloadDefinition } from "./payload/index.js";
 *
 *   const definition: PayloadDefinition = { id, name, fields, schema };
 *   const generator = createPayloadGenerator(definition);
 *   const result = generator.generate(inputContext);
 *   if (result.success) { use(result.data); } else { handle(result.errors); }
 *
 * New payload types are added by passing a new `PayloadDefinition` to
 * `createPayloadGenerator` — no change to the core engine is required (AC-8).
 */

export type {
  InputContext,
  SourceDefinition,
  TransformationRule,
  OutputField,
  PayloadDefinition,
  LogEntry,
  ValidationError,
  Result,
  FieldResolution,
} from './types.js';

export { createPayloadGenerator } from './engine.js';
export type { PayloadGenerator, PayloadEngineLog } from './engine.js';