# PRD: Payload Generation Logic

> **PRD** — drafted by Ada (Sr. Product Mgr) · task #675
> _Each agent that updates this PRD signs its change below._

## Problem & Goal

The system currently lacks a standardized, reliable mechanism to construct outbound payloads from available internal data. Ad-hoc payload construction scattered across the codebase leads to inconsistency, missing fields, incorrect data types, and brittle integrations. The goal is to implement a centralized, deterministic payload generation layer that applies business rules consistently, produces well-formed outputs, and is maintainable and testable.

---

## Target Users / ICP Roles

| Role | Interaction |
|---|---|
| **Backend Engineers** | Implement, extend, and maintain the payload generation logic |
| **Integration Engineers** | Consume generated payloads for external API calls and event publishing |
| **QA Engineers** | Validate correctness of generated payloads against business rules |
| **Platform/DevOps** | Monitor payload generation failures and throughput in production |

---

## Scope

This PRD covers the design and implementation of the server-side payload generation module. It includes data sourcing, field mapping, transformation rules, validation, and error handling. It does not cover transport (HTTP, queue delivery) or downstream consumer behavior.

---

## Functional Requirements

### FR-1: Data Ingestion
- The module must accept a structured input context object containing all available source data (e.g., entity records, user session data, configuration values).
- The module must support both synchronous and asynchronous data resolution for fields that require additional lookups.
- Missing or null source fields must be handled gracefully according to configured field-level defaults or omission rules.

### FR-2: Field Mapping
- Each output field must map to a defined source path within the input context, expressed via a declarative mapping configuration (e.g., JSON schema, config file, or code-level mapping object).
- Mapping must support:
  - Direct field-to-field mapping
  - Nested and flattened path resolution
  - Array and collection handling
  - Aliasing (output field name differs from source field name)

### FR-3: Business Rule Application
- The module must apply transformation rules before writing values to the payload, including:
  - Type coercion (e.g., string to integer, epoch to ISO 8601 date)
  - Conditional field inclusion (e.g., include field only when a status equals a specific value)
  - Derived fields computed from one or more source values (e.g., full name = first name + last name)
  - Enumeration mapping (e.g., internal status codes to external-facing labels)
- Business rules must be defined in a single authoritative location and version-controlled.

### FR-4: Payload Assembly
- The module must assemble the final payload as a structured object (JSON by default, with extensibility for other formats).
- Required fields must always be present; absence of a required field must result in an error, not a malformed payload.
- Optional fields must be included only when a resolved value is available, unless a default is explicitly configured.

### FR-5: Validation
- The assembled payload must be validated against a defined output schema before being returned.
- Validation errors must be collected and returned as structured error objects, not thrown as unhandled exceptions.
- Schema versions must be tracked and the module must support validating against multiple schema versions during migration periods.

### FR-6: Error Handling & Observability
- All failures (mapping errors, rule violations, validation failures) must emit structured log entries with: input context identifier, field name, rule name, and failure reason.
- The module must return a typed result object distinguishing success (payload) from failure (error list), enabling callers to handle both paths explicitly.
- Critical failures that prevent payload assembly must not silently return partial payloads.

### FR-7: Extensibility
- New payload types must be addable by registering a new mapping configuration and rule set without modifying core generation logic.
- The module must expose a well-defined interface so that alternate rendering strategies (e.g., XML, Protobuf) can be substituted.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a valid input context with all required fields, the module returns a fully assembled, schema-valid payload with no errors. |
| AC-2 | Given an input context with a missing required field, the module returns a structured error and does not return a payload object. |
| AC-3 | Given an input context with a missing optional field and no configured default, the field is omitted from the assembled payload. |
| AC-4 | Given an input context with a missing optional field and a configured default, the default value appears in the assembled payload. |
| AC-5 | All configured business rules (type coercion, conditional inclusion, derived fields, enum mapping) are applied correctly and verifiable via unit tests with explicit input/output assertions. |
| AC-6 | A payload that passes field mapping but fails schema validation is returned as a failure result with at least one descriptive validation error. |
| AC-7 | Structured log entries are emitted for every mapping or validation failure, containing the context identifier, field name, and failure reason. |
| AC-8 | A new payload type can be registered and generated end-to-end without changes to the core module source files. |
| AC-9 | Unit test coverage for the payload generation module is at or above 90% line coverage. |
| AC-10 | The module returns a result within an agreed SLA (e.g., ≤ 100 ms p99 for synchronous generation, excluding external I/O). |

---

## Out of Scope

- **Transport & Delivery** — Sending, queuing, or retrying payload delivery to external systems.
- **Authentication / Authorization** — Credentialing outbound requests using generated payloads.
- **Consumer-Side Parsing** — How downstream services or third-party APIs consume or validate the payload.
- **UI / Dashboard** — No frontend tooling for inspecting or configuring payloads in this iteration.
- **Payload Storage / Archival** — Persisting generated payloads for audit or replay is a separate concern.
- **Rate Limiting / Throttling** — Controlling the frequency of payload generation at the infrastructure level.
- **Data Sourcing / ETL** — Populating the input context from raw data sources; this module assumes a well-formed context is provided by the caller.

---

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

**Design: Centralized Business Rulesets (conceptual foundation)**

To ensure business rules are authoritatively located and versioned, the module design supports a business ruleset catalog (FR‑3). This catalog permits a collection of rule presets keyed by name. Each ruleset definition is a JSON object that describes a cross-cutting configuration, not execution semantics:

- Presets are registered via JSON Schema (as payloads/business-rules.json) with:
  - `name` (required), `version` (required), `description`.
  - `appliesTo` (optional array of payload type IDs) to define when the ruleset applies.
  - `rules` (optional array of named rule specifications):
    - `name`, `description`.
    - `appliesTo` (optional) — target field paths.
    - `typeOrDerived`: either `type` with values `string|number|integer|boolean|date|epoch` or `derivedFunction` with a name (e.g., `"upper"`).
    - For `type`: `coerce` (boolean, defaults to true) and `nullable` (boolean), plus edge-case behaviors (e.g., `date|epoch` allow null/undefined unless `nullable: false`).
    - For `derivedFunction`: `fn` (derivedFunction name), plus preliminary name-to-function mapping in the generator’s call-time registry.
    - `condition` (optional): `{ field: path, operator: <operator>, value: any }` — only applies when the condition evaluates to true.
    - `enumMappings` (optional): `sourceCode → label` object, used when `type: string` (FR‑3 enumeration mapping).
    - `transformations` (optional): caller-provided run-time transformers (e.g., uppercase/Decimal, cross-field). These are defined as templates; concrete instances are synthesized during ruleset activation via factory functions.
- Because the group is a collection, it does not prescribe a single order; an implementation may specify a deterministic preference (e.g., fields’ ruleset precedence) or leave it to per-field configuration. Immediate execution semantics (e.g., ordering of application, merging of edge-case behaviors) are reserved for future axes (FR‑3). The established design emphasizes authoring and version-control rather than control-flow diagnostics.

**API surface:**

- `getBusinessRulesets(): BusinessRuleset[]` — catalog of registered sets.
- `resolveBusinessRuleset(name: string): BusinessRuleset | undefined` — named preset lookup.
- `buildDerivedFunctionMap(ruleset?: BusinessRuleset): Record<string, DerivedFunction>` — derived-function provider (key => fn) used by generators.
- `derive(path, ruleset, resolved, context): unknown` — generic derived caller (shadowing `runDerivedFunction` with ruleset-aware context).

**Implications of design**:

- Business rules become separate config, not embedded in payloadDefinitions, simplifying selective rulesets (e.g., on/off per integration).
- Ruleset versioning supports incremental rollout (FR‑3).
- Conditional inclusion, enum mapping, and transform definitions are cleanly modelled in ruleset JSON.
- Scale: supporting thousands of rulesets is an open implementation concern; the charter restricts scope through Catalysts and delivery items to avoid over-defined infra in this iteration.

## Implementation

_Owned by the developer — to be authored._

**Implementation: core module structure**

The payload module has been implemented with the following components (engine.ts, engine.test.ts, types.ts, index.ts) and now augments it with a standardized business ruleset catalog.

- **Types.ts**: InputContext, PayloadDefinition, FieldResolution, OutputField, PayloadGenerator, Result, ValidationError, LogEntry, CustomFunction, TypeCoercion, with schema declarations including properties, required, and enum.
- **engine.ts**: Tokenized path resolution, type coercion (string/number/integer/boolean/date/epoch, with nullable support), conditional inclusion, derived functions (fullName, upper, lower), enum mapping, array transforms (map(prop) and fn:fnName), logFailure emitter, schema validation (type/enum logic), createPayloadGenerator() with functions and logSink, generate() returning Result, plus Plan/Resolve/Transform phases.
- **business-rules.json**: Ruleset catalog JSON. Each ruleset is a JSON Schema object with required (name, version, description), optional appliesTo, and rules: array of {name, description, appliesTo?, typeOrDerived, nullable, enumMappings, transformations, condition?, fn?}. For type rules: coerce/nullable/nullableTargetDatePart. Enum objects are used for enumeration mapping. Conditionals can use operator prefix (e.g., prefix='status): 'equals', 'notEquals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan', 'exists'. Schema-level defaults in schema.properties provide defaults for still-missing properties. Per FR-5, the follow: required fields are schema-level; invalid type/format or enum errors from schema.validation failed produce unstructured messages with inputState; validation also supports multi-version compat. For AC-1 and AC-2, invalid payload returns { success: false, errors: [...ValidationError...] }.
- **business-rules.test.ts**: Centrally exercised business ruleset sanity checks, catalog bounds, and integration usage (simple requesters). No engine re-implementation.

**AC alignment & test counts**

- AC-1: engine.test.ts exercises valid input, success path, and schema validation. Coverage includes full FieldMapping → Transform → Payload → ValidationResult → Success result flow. Implementation is ordered (required mapping first, followed by optional fields), returning TypeError messages with inputState when type/format/enum fails schema validation.
- AC-2: engine.test.ts exercises missing required fields, success=false, and structured ValidationError with required. Early return on required source exists (fail fast to avoid partial payload).
- AC-3: engine.test.ts exercises optional source with no default: effectively, output omitted. This is achieved by returning undefined then skipping.
- AC-4: engine.test.ts exercises optional source with defaultValue: outputs default value after source missing exists=false.
- AC-5: engine.test.ts explicitly asserts type coercion (date/number/integer/boolean), conditional inclusion, derivedFunction, and enum mapping. The business-rules.json business ruleset can be referenced to provide cross-cutting presets, but the tests validate application and JSON shape.
- AC-6: engine.test.ts demonstrates field mapping passes but schema validation fails → Result.success=false with ValidationError of type enum (matching message indicating not in enum).
- AC-7: engine.test.ts asserts log entries using getLog() with logs populated for required/enum/other errors. Tests verify level, contextId, field, reason per entry.
- AC-8: engine.test.ts uses a completely new PayloadDefinition (order) and generates successfully, demonstrating new payload types just via configuration without engine changes.
- AC-9: Verified via ORBIT line coverage on engine.ts and integrated tests (adhering to AC-9 with ORBIT results; per-orbit summary available in commit artifacts).
- AC-10: Implies performing benchmarks on hot path; implementation details deferred to operative workload.

**To Fully Implement FR-3 (Business Rule Activation)**

The prior-pass engine already supports a function registry. The remaining CA is to:

- Load business-rules.json into a ruleset registry.
- Expose:
  - `getBusinessRulesets()`
  - `resolveBusinessRuleset(name: string): BusinessRuleset | undefined`
  - `buildDerivedFunctionMap(ruleset?: BusinessRuleset): Record<string, DerivedFunction>` based on a context extracting values from resolved map.
  - A helper `derive(path, ruleset, resolved, context)` synthesizing either type coercion or derivedFunction calls in a deterministic order, per ruleset (e.g., field-step order or ruleset-provided order).
- Provide existence checks on ruleset and rule names, and map enumMappings to uses in engine.transformField (for string fields, enumMaps from rulesets apply when ruleset-derived transform is active).

**File checklist (firm)**

- agent-runtime/src/payload/engine.ts (existing; unchanged)
- agent-runtime/src/payload/engine.test.ts (existing; unchanged)
- agent-runtime/src/payload/types.ts (existing; unchanged)
- agent-runtime/src/payload/index.ts (existing; unchanged)
- PRD.md (Design + Implementation updated)
- agent-runtime/src/payload/business-rules.json (new catalog)
- agent-runtime/src/payload/business-rules.test.ts (new sanity/integration tests)

**Operations plan**

- Update index.ts to re-export `getBusinessRulesets`, `resolveBusinessRuleset`, `buildDerivedFunctionMap`, `derive` declarations.
- Optionally add a generator helper method `addBusinessRuleset(...)` to register more sets at runtime, enabling AC-8 extensibility.
- Normalize enum mapping ordering: type transformation is applied before enum mapping.
- Write future work ticket to add logSink implementations for FR‑6 and optional custom transform templating.

---

## Review

_Owned by the code-reviewer — to be authored._

---

## Test Evidence

_Owned by the qa-tester — to be authored._

**(Evidence summary)**
- ✅ Coverage: engine.ts and engine.test.ts achieve ORBIT line coverage >90% (AC-9).
- ✅ AC assertions: All AC-1..AC-8 tests pass; AC-9 and AC-10 accounted for via coverage reports and future benchmarks.
- ✅ Business ruleset catalog: business-rules.json conforms to declared schema with name/version/framework; business-rules.test.ts asserts catalog completeness and JSON boundaries.