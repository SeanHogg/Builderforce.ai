/**
 * Payload Generation Module
 * Centralized payload generation with declarative field mapping, business rules,
 * transformation, and schema validation.
 *
 * Usage:
 *   import { createPayloadGenerator, type PayloadDefinition } from "./payload/index.js";
 *
 *   const definition: PayloadDefinition = {
 *     id: "user.v1",
 *     name: "User Payload",
 *     fields: [
 *       { name: "id", source: { path: "user.id", required: true } },
 *       { name: "displayName", source: { path: "user.name" }, alias: "display_name" },
 *       { name: "status", source: { path: "user.status" }, transform: { enumMap: { A: "active", I: "inactive" } } },
 *       { name: "createdAt", source: { path: "user.createdEpoch" }, transform: { type: { type: "date" } } },
 *     ],
 *     schema: {
 *       required: ["id"],
 *       properties: {
 *         id: { type: "string" },
 *         display_name: { type: "string" },
 *         status: { type: "string", enum: ["active", "inactive"] },
 *         createdAt: { type: "string" },
 *       },
 *     },
 *   };
 *
 *   const generator = createPayloadGenerator(definition);
 *   const result = generator.generate(inputContext);
 *   if (result.success) { use(result.data); } else { handle(result.errors); }
 *
 * New payload types are added by passing a new `PayloadDefinition` (and optional
 * custom functions) to `createPayloadGenerator` — no change to the core engine is
 * required (FR-7 / AC-8).
 */

export type {
  InputContext,
  SourceDefinition,
  TypeCoercion,
  OutputField,
  PayloadDefinition,
  PayloadGenerator,
  LogEntry,
  ValidationError,
  Result,
  FieldResolution,
} from "./types.js";

export { createPayloadGenerator } from "./engine.js";
export type { CustomFunction } from "./engine.js";
