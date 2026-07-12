/**
 * Payload Generation Module
 *
 * This module provides a centralized, declarative way to construct,
 * transform, and validate outgoing payloads for integration or event
 * publishing.
 *
 * Overview
 * --------
 * - Declarative configuration (PayloadDefinition) defines which source
 *   fields map to which output fields and how data should be transformed.
 * - A Generator (createPayloadGenerator) knows the mapping, validation
 *   schema, and any registered custom functions.
 * - Generation is performed via `.generate(context)` and returns a
 *   `Result<T>` that expresses success or a list of structured errors.
 *
 * Basic Usage
 * -----------
 * import { createPayloadGenerator } from "./engine.js";
 * import type { Result } from "./engine.js";
 *
 * const def = {
 *   id: "example-payload-v1",
 *   schema: {
 *     required: ["id", "fullName"],
 *     properties: {
 *       id: { type: "string" },
 *       fullName: { type: "string", required: true },
 *     },
 *   },
 *   fields: [
 *     {
 *       name: "fullName",
 *       source: { path: "user.profile.name", required: true },
 *     },
 *   ],
 * };
 *
 * const generator = createPayloadGenerator(def);
 * const result: Result<Record<string, unknown>> = generator.generate({
 *   user: { profile: { name: "Alice" } },
 * });
 *
 * if (!result.success) {
 *   console.error("Payload generation failed:", result.errors);
 * } else {
 *   console.log("Payload:", JSON.stringify(result.data, null, 2));
 * }
 *
 * Key Features
 * ------------
 * - Field Mapping
 *   - Direct: "user.id" → "id" (default).
 *   - Aliasing: alias: "userId" for a field named "id".
 *   - Paths: use dot notation and index brackets (e.g., "items[0].name").
 *
 * - Transformations
 *   - Type coercion: transform: { type: "number" } via transform.type
 *   - Derived functions: transform: { derivedFunction: "upper" }
 *   - Array transforms: transform: { arrayTransform: { field: "tags", transform: "fn:upperAt" } }
 *
 * - Default Values
 *   - source.defaultValue is applied when the source is missing and the field
 *     is not required.
 *   - Schema-level defaults (schema.properties[key].default) are applied
 *     after all field resolutions.
 *
 * - Validation
 *   - Required fields must appear in the schema (schema.required or
 *     properties with required: true). Missing required fields result in a
 *     Result.success=false with a validation error.
 *   - Values are validated against their declared schema type and enum.
 *
 * - Error Handling & Observability
 *   - Result.success indicates successful generation; Result.errors is a
 *     structured list of ValidationError objects.
 *   - Every error and validation failure is emitted as a LogEntry.
 *     You can provide an optional `logSink` callback to receive logs in
 *     real time (FR‑6). The log entries contain contextId, field name,
 *     level, and reason.
 *
 * - Extensibility
 *   - New payload types are added by registering a new PayloadDefinition.
 *   - Custom transformation functions can be registered by passing a
 *     `functions` object to createPayloadGenerator. Functions must be
 *     compatible with the CustomFunction signature:
 *         type CustomFunction = (args: {
 *           context: InputContext;
 *           resolved: Record<string, FieldResolution>;
 *           sourcePath: string;
 *         }) => unknown;
 *   - Alternating output formats (XML, Protobuf) can be implemented by
 *     returning an object that the caller serializes, leaving concrete
 *     transport concerns to the calling code.
 *
 * Asynchronous Resolution (Future)
 * ---------------------------------
 * The SourceDefinition supports an async flag, but actual async pipeline
 * resolution is not implemented in this iteration. Lookups are performed
 * synchronously. When ready, a generator methodchain can sequence async
 * fetches and replace resolved results in the context before calling
 * generate().
 *
 * Logging Strategy
 * ----------------
 * Since the generator remembers state between calls, you can accumulating
 * logs and optionally reset them with .resetLog(). To avoid state
 * accumulation across generations, create a new generator per call.
 * Alternatively, provide logSink to receive entries immediately without
 * retaining them in memory.
 */

export { createPayloadGenerator } from "./engine.js";
export type { CustomFunction } from "./engine.js";
export type { InputContext, FieldResolution, OutputField, PayloadDefinition, PayloadGenerator, Result, TypeCoercion, ValidationError, LogEntry } from "./types.js";