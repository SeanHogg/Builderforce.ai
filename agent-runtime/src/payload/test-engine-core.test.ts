/**
 * Payload Engine Unit Tests — Core Engine (Types/Coercion/Conditional/Enum/Schema/Logs)
 *
 * AC coverage:
 * - AC-1: payload with all required fields returns valid payload with no errors.
 * - AC-2: missing required field returns structured error (no payload).
 * - AC-3: missing optional field, no default configured — omitted (not included).
 * - AC-4: missing optional field with default configured — default appears.
 * - AC-5: type coercion, conditional inclusion, derived fields (derivedFunction), enum mapping applied correctly (unit tests).
 * - AC-6: payload passes field mapping but fails schema validation => failure result with descriptive validation error.
 * - AC-7: structured log entries for every mapping/validation failure (contextId, field, reason).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type {
  CustomFunction,
} from "./engine.js";
import {
  createPayloadGenerator,
} from "./engine.js";
import type {
  InputContext,
  TripDefinition,
} from "./types.js";

// ----------------------------------------------------------------------
// Fixtures and Mocks
// ----------------------------------------------------------------------

function createTripInputContext(cx: Partial<InputContext> = {}): InputContext {
  return {
    tripId: "T123",
    name: "Demo Trip",
    status: "ACTIVE",
    createdEpoch: 1704067200,
    distanceKm: 120,
    passengers: [
      { firstName: "Bob", lastName: "Smith", seatNumber: "1A" },
      { firstName: "Alice", lastName: "Jones", seatNumber: "2B" },
    ],
    metadata: { luxury: true, classes: ["economy", "business"] },
    ...cx,
  };
}

let mock customLog: string[] = [];
function resetMockLog() {
  mock customLog = [];
}

// ----------------------------------------------------------------------
// Custom Functions Registry (Mocked)
// ----------------------------------------------------------------------
const mock customFunctions: Record<string, CustomFunction> = {
  upper: ({ sourcePath }) => `PREFIX-${sourcePath.toString().toUpperCase()}`,
  fullName: ({ resolved }) => {
    const first = resolved["first"]?.value ?? "";
    const last = resolved["last"]?.value ?? "";
    if (first || last) return `${first.trim()} ${last.trim()}`.trim();
    return undefined;
  },
  // reserved: will be injected only via createPayloadGenerator.fitMockedFunctions to keep core tests pure
};

// ----------------------------------------------------------------------
// Test Cases
// ----------------------------------------------------------------------

describe("Payload Engine — Core Engine Types & Coercion", () => {
  beforeEach(() => {
    resetMockLog();
  });

  afterEach(() => {
    resetMockLog();
  });

  it("AC-1 — fully input with all required fields returns valid payload with no errors", () => {
    const definition = getTripDefinition();
    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext());

    expect(result.success).toBe(true);
    if (!result.success) {
      for (const e of result.errors) {
        console.log("error", e.field, e.message);
      }
    }
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect(payload).toMatchObject({
      tripId: "T123",
      name: "Demo Trip",
      status: "ACTIVE",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
      distanceKm: 120,
      passengersCount: 2,
      passengerNames: [
        "Bob Smith",
        "Alice Jones",
      ],
      isLuxury: true,
      passengerNamesUppercase: [
        "PREFIX-PASSANGERS[0].FIRSTNAME",
        "PREFIX-PASSANGERS[1].FIRSTNAME",
      ],
    });
  });

  it("AC-2 — missing required 'tripId' returns structured error (no payload)", () => {
    const definition = getTripDefinition();
    const generator = createPayloadGenerator(definition);
    const result = generator.generate({} as InputContext);

    expect(result.success).toBe(false);
    const err = result.errors.find((e) => e.field === "tripId");
    expect(err).toBeDefined();
    expect(err?.message).toContain("Required source 'tripId' is missing");
  });

  it("AC-3 — missing optional field 'displayName' with no default configured, omit it", () => {
    const definition = getTripDefinition();
    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ displayName: undefined }));

    expect(result.success).toBe(true);
    if (!result.success) {
      for (const e of result.errors) {
        console.log("error", e.field, e.message);
      }
    }
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect("displayName" in payload).toBe(false); // omitted
    expect("name" in payload).toBe(true); // maps to name
  });

  it("AC-4 — missing optional field 'metadata.luxury' with default configured appears in payload", () => {
    const definition = getTripDefinition();
    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ metadata: { luxury: undefined } }));

    expect(result.success).toBe(true);
    if (!result.success) {
      for (const e of result.errors) {
        console.log("error", e.field, e.message);
      }
    }
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect("metadata" in payload).toBe(true);
    expect(payload.metadata).toMatchObject({ luxury: true }); // default applied
  });

  it("AC-5 — type coercion (date, integer, enum, array) applied correctly", () => {
    const definition: TripDefinition = {
      id: "trip-coercion",
      name: "Coercion Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
        { name: "createdAt", source: { path: "createdEpoch", transform: { type: { type: "date" } } } },
        { name: "distanceMiles", source: { path: "distanceKm", transform: { type: { type: "number" } } } },
        { name: "statusLabel", source: { path: "status", transform: { enumMap: { ACTIVE: "Active", INACTIVE: "Inactive", CANCELLED: "Cancelled" } } } },
        { name: "passengerFirstNames", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "map(firstName)" } } } },
      ],
      schema: {
        required: ["tripId"],
        properties: {
          tripId: { type: "string" },
          createdAt: { type: "string" },
          distanceMiles: { type: "number" },
          statusLabel: { type: "string" },
          passengerFirstNames: { type: "array" },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ createdEpoch: "1704067200" }));

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect(payload.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/);
    expect(payload.distanceMiles).toBe(120);
    expect(payload.statusLabel).toBe("Active");
    expect(payload.passengerFirstNames).toEqual(["Bob", "Alice"]);
  });

  it("AC-5 — conditional inclusion logic applied correctly", () => {
    const definition: TripDefinition = {
      id: "trip-inclusion",
      name: "Inclusion Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
        { name: "isLuxury", includeIf: { field: "status", operator: "equals", value: "ACTIVE" }, source: { path: "metadata.luxury", defaultValue: false } },
        { name: "cancelReason", includeIf: { field: "status", operator: "notEquals", value: "ACTIVE" }, source: { path: "cancelReason" } },
      ],
      schema: {
        required: ["tripId"],
        properties: {
          tripId: { type: "string" },
          isLuxury: { type: "boolean" },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ status: "ACTIVE" }));

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect(payload.isLuxury).toBe(true);
    expect("cancelReason" in payload).toBe(false);

    const result2 = generator.generate(createTripInputContext({ status: "CANCELLED", cancelReason: "unknown" }));
    expect(result2.success).toBe(true);
    if (!result2.success) {
      for (const e of result2.errors) {
        console.log("error", e.field, e.message);
      }
    }
    expect(result2.errors).toHaveLength(0);
    expect("isLuxury" in result2.data).toBe(false);
    expect(result2.data.cancelReason).toBe("unknown");
  });

  it("AC-6 — payload passes field mapping but fails schema validation => failure result with validation error", () => {
    const definition: TripDefinition = {
      id: "trip-schema",
      name: "Schema Validation Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
      ],
      schema: {
        required: ["tripId", "tripStatus"],
        properties: {
          tripId: { type: "string" },
          tripStatus: { type: "string", enum: ["active", "inactive"] },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext());

    expect(result.success).toBe(false);
    if (!result.success) {
      for (const e of result.errors) {
        console.log("error", e.field, e.message);
      }
    }
    expect(result.errors).toHaveLength(1);
    const err = result.errors.find((e) => e.field === "tripStatus");
    expect(err).toBeDefined();
    expect(err?.type).toBe("enum");
  });

  it("AC-7 — structured log entries for every mapping/validation failure", () => {
    const definition: TripDefinition = {
      id: "trip-logs",
      name: "Logs Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
        { name: "statusSymbol", includeIf: { field: "status", operator: "equals", value: "X" }, source: { path: "status" } },
        { name: "distanceMiles", source: { path: "distanceKm" } },
      ],
      schema: {
        required: ["tripId"],
        properties: {
          tripId: { type: "string" },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ status: "X" }));

    // IncludeIf fails: AC-7 logs for missing field
    expect(result.success).toBe(true);
    const logs = generator.getLog();
    // Expect broad filtering and restore to avoid false positives:
    const relevantLogs = logs.filter(
      (l) =>
        l.field !== undefined &&
        (
          l.field === "statusSymbol" ||
          l.field === "status" ||
          (l.field === "distanceKm" && l.reason.includes("missing or null")) ||
          (l.field === "distanceMiles" && l.reason.includes("missing"))
        )
    );
    expect(relevantLogs.length).toBeGreaterThanOrEqual(2); // <--- at least two log entries matching expectations
  });
});

describe("Payload Engine — Core Engine DerivedFunction", () => {
  beforeEach(() => {
    resetMockLog();
  });

  afterEach(() => {
    resetMockLog();
  });

  it("FR-2 / AC-5 — DerivedFunction fullName works correctly", () => {
    const definition: TripDefinition = {
      id: "trip-derivedfull",
      name: "Derived FullName Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
        { name: "passengerNames", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "fn:fullName" } } } },
      ],
      schema: {
        required: ["tripId"],
        properties: {
          tripId: { type: "string" },
          passengerNames: { type: "array" },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext());

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    const payload = result.data;
    expect(payload.passengerNames).toEqual(["Bob Smith", "Alice Jones"]);
  });

  it("AC-7 — DerivedFunction interaction emits logs correctly", () => {
    const definition: TripDefinition = {
      id: "trip-logs-derive",
      name: "Derived Logs Test",
      fields: [
        { name: "tripId", source: { path: "tripId", required: true } },
        { name: "passengerNames", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "fn:fullName" } } } },
      ],
      schema: {
        required: ["tripId"],
        properties: {
          tripId: { type: "string" },
          passengerNames: { type: "array" },
        },
      },
      schemaVersion: "1.0",
    };

    const generator = createPayloadGenerator(definition);
    const result = generator.generate(createTripInputContext({ passengers: undefined }));

    expect(result.success).toBe(true); // passes with defaults
    const logs = generator.getLog();
    const relevantLogs = logs.filter(
      (l) =>
        l.field !== undefined &&
        (
          l.field === "format" ||
          (l.field === "passengerNames" && l.reason.includes("missing or null"))
        )
    );
    expect(relevantLogs.length).toBeGreaterThanOrEqual(1); // at least one relevant line
  });
});

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function getTripDefinition(): TripDefinition {
  return {
    id: "trip",
    name: "Trip V1",
    fields: [
      { name: "tripId", source: { path: "tripId", required: true } },
      { name: "displayName", source: { path: "name" }, alias: "display_name" },
      { name: "status", source: { path: "status" } },
      { name: "createdAt", source: { path: "createdEpoch", transform: { type: { type: "date" } } } },
      { name: "distanceKm", source: { path: "distanceKm" } },
      { name: "passengersCount", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "fn:fullName" } } } },
      { name: "passengerNames", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "map(firstName)" } } } },
      { name: "isLuxury", includeIf: { field: "status", operator: "equals", value: "ACTIVE" }, source: { path: "metadata.luxury", defaultValue: false } },
      { name: "passengerNamesUppercase", source: { path: "passengers", transform: { arrayTransform: { field: "passengers", transform: "fn:upper" } } } },
    ],
    schema: {
      required: ["tripId"],
      properties: {
        tripId: { type: "string" },
        display_name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "INACTIVE", "CANCELLED"] },
        createdAt: { type: "string" },
        distanceKm: { type: "number" },
        passengersCount: { type: "integer" },
        passengerNames: { type: "array" },
        isLuxury: { type: "boolean" },
        passengerNamesUppercase: { type: "array" },
      },
    },
    schemaVersion: "1.0",
  };
}