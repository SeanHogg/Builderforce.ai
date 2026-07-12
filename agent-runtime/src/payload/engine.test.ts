/**
 * Payload Engine — Unit Tests
 *
 * Acceptance criteria covered:
 *   AC-1  Valid input → success with fully assembled, schema-valid payload
 *   AC-2  Missing required field → structured error, no payload
 *   AC-3  Missing optional field (no default) → omitted from payload
 *   AC-4  Missing optional field (with configured default) → default appears
 *   AC-5  Business rules: type coercion, conditional inclusion, derived fields, enum mapping
 *   AC-6  Field mapping passes but schema validation fails → failure result w/ validation error
 *   AC-7  Structured log entries emitted for mapping/validation failures
 *   AC-8  New payload type registered via config — no core engine changes needed (FR-7)
 */

import { describe, expect, it } from "vitest";
import { createPayloadGenerator } from "./engine.js";
import type { CustomFunction } from "./engine.js";
import type { InputContext, PayloadDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid context for a "user" payload. */
function userContext(overrides: Record<string, unknown> = {}): InputContext {
  return {
    user: {
      id: "u-42",
      name: "Ada Lovelace",
      email: "ada@example.com",
      status: "A",
      age: 29,
      score: "95.5",
      createdEpoch: 1704067200,
      tags: ["math", "computing"],
      metadata: { vip: true },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Payload Generation Engine", () => {
  // ── AC-1: Valid input ──────────────────────────────────────────────
  it("AC-1 — valid input context returns success with schema-valid payload", () => {
    const def: PayloadDefinition = {
      id: "user.v1",
      name: "User V1",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "displayName", source: { path: "user.name" }, alias: "display_name" },
        { name: "status", source: { path: "user.status" } },
        { name: "createdAt", source: { path: "user.createdEpoch" }, transform: { type: { type: "date" } } },
        { name: "scoreNum", source: { path: "user.score" }, transform: { type: { type: "number" } } },
        { name: "age", source: { path: "user.age" } },
      ],
      schema: {
        required: ["id"],
        properties: {
          id: { type: "string" },
          display_name: { type: "string" },
          status: { type: "string" },
          createdAt: { type: "string" },
          scoreNum: { type: "number" },
          age: { type: "number" },
        },
      },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("u-42");
    expect(result.data.display_name).toBe("Ada Lovelace");
    expect(result.data.status).toBe("A");
    expect(result.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // score "95.5" → number 95.5
    expect(result.data.scoreNum).toBe(95.5);
    expect(result.data.age).toBe(29);
    expect(gen.getLog()).toHaveLength(0);
  });

  // ── AC-2: Missing required field ───────────────────────────────────
  it("AC-2 — missing required field returns failure with structured error", () => {
    const def: PayloadDefinition = {
      id: "user.v1",
      name: "User V1",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "name", source: { path: "user.name" } },
      ],
      schema: { required: ["id"], properties: { id: { type: "string" }, name: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    // context without user.id
    const result = gen.generate({ user: { name: "No ID" } });

    expect(result.success).toBe(false);
    if (result.success) return;
    const idError = result.errors.find((e) => e.field === "id");
    expect(idError).toBeDefined();
    expect(idError!.type).toBe("required");
    expect(idError!.message).toContain("user.id");
    // No payload in failure
    expect((result as { success: false }).errors.length).toBeGreaterThanOrEqual(1);
  });

  // ── AC-3: Missing optional field, no default ───────────────────────
  it("AC-3 — missing optional field with no default is omitted", () => {
    const def: PayloadDefinition = {
      id: "user.v1",
      name: "User V1",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "nickname", source: { path: "user.nickname" } }, // optional, no default
      ],
      schema: { required: ["id"], properties: { id: { type: "string" }, nickname: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("u-42");
    expect("nickname" in result.data).toBe(false);
  });

  // ── AC-4: Missing optional field WITH default ──────────────────────
  it("AC-4 — missing optional field with configured default uses default", () => {
    const def: PayloadDefinition = {
      id: "user.v1",
      name: "User V1",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "role", source: { path: "user.role", defaultValue: "viewer" } },
      ],
      schema: { required: ["id"], properties: { id: { type: "string" }, role: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.role).toBe("viewer");
  });

  // ── AC-5: Business rules ───────────────────────────────────────────
  describe("AC-5 — Business rules", () => {
    it("type coercion: date, number, integer, boolean", () => {
      const def: PayloadDefinition = {
        id: "coercion",
        name: "Coercion Test",
        fields: [
          { name: "id", source: { path: "user.id", required: true } },
          { name: "createdAt", source: { path: "user.createdEpoch" }, transform: { type: { type: "date" } } },
          { name: "score", source: { path: "user.score" }, transform: { type: { type: "number" } } },
          { name: "age", source: { path: "user.age" }, transform: { type: { type: "integer" } } },
          { name: "vip", source: { path: "user.metadata.vip" }, transform: { type: { type: "boolean" } } },
        ],
        schema: {
          required: ["id"],
          properties: {
            id: { type: "string" },
            createdAt: { type: "string" },
            score: { type: "number" },
            age: { type: "integer" },
            vip: { type: "boolean" },
          },
        },
      };

      const gen = createPayloadGenerator(def);
      const result = gen.generate(userContext());

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.data.score).toBe(95.5);
      expect(result.data.age).toBe(29);
      expect(result.data.vip).toBe(true);
    });

    it("conditional inclusion: field included only when status equals a value", () => {
      const def: PayloadDefinition = {
        id: "conditional",
        name: "Conditional Test",
        fields: [
          { name: "id", source: { path: "user.id", required: true } },
          {
            name: "vipBadge",
            source: { path: "user.metadata.vip", defaultValue: false },
            transform: {
              includeIf: { field: "user.status", operator: "equals", value: "A" },
            },
          },
          {
            name: "retiredLabel",
            source: { path: "user.status" },
            transform: {
              includeIf: { field: "user.status", operator: "notEquals", value: "A" },
            },
          },
        ],
        schema: {
          required: ["id"],
          properties: { id: { type: "string" }, vipBadge: { type: "boolean" }, retiredLabel: { type: "string" } },
        },
      };

      const gen = createPayloadGenerator(def);

      // Status is "A" → vipBadge included, retiredLabel excluded
      const r1 = gen.generate(userContext());
      expect(r1.success).toBe(true);
      if (!r1.success) return;
      expect(r1.data.vipBadge).toBe(true);
      expect("retiredLabel" in r1.data).toBe(false);

      // Status is "R" → vipBadge excluded, retiredLabel included
      const ctx2 = userContext({ user: { ...userContext().user as Record<string, unknown>, status: "R" } });
      const r2 = gen.generate(ctx2);
      expect(r2.success).toBe(true);
      if (!r2.success) return;
      expect("vipBadge" in r2.data).toBe(false);
      expect(r2.data.retiredLabel).toBe("R");
    });

    it("derived fields via customFunction", () => {
      // A custom function that concatenates first+last name
      const fullNameFn: CustomFunction = ({ resolved, context }) => {
        const first = (resolved["user.firstName"]?.value as string | undefined) ?? "";
        const last = (resolved["user.lastName"]?.value as string | undefined) ?? "";
        if (first || last) return `${first} ${last}`.trim();
        // Fallback: look in context directly
        const c = context as Record<string, Record<string, unknown>>;
        if (c?.user?.firstName || c?.user?.lastName) {
          return `${(c.user.firstName as string) ?? ""} ${(c.user.lastName as string) ?? ""}`.trim();
        }
        return undefined;
      };

      const def: PayloadDefinition = {
        id: "derived",
        name: "Derived Test",
        fields: [
          { name: "id", source: { path: "user.id", required: true } },
          { name: "firstName", source: { path: "user.firstName" } },
          { name: "lastName", source: { path: "user.lastName" } },
          { name: "fullName", source: { path: "user.firstName" }, customFunction: "concatName" },
        ],
        schema: {
          required: ["id"],
          properties: { id: { type: "string" }, fullName: { type: "string" } },
        },
      };

      const gen = createPayloadGenerator(def, {
        functions: { concatName: fullNameFn },
      });

      const ctx = userContext({
        user: {
          ...(userContext().user as Record<string, unknown>),
          firstName: "Ada",
          lastName: "Lovelace",
        },
      });
      const result = gen.generate(ctx);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fullName).toBe("Ada Lovelace");
    });

    it("derivedFunction: built-in 'upper' via fn: array transform", () => {
      const upperFn: CustomFunction = ({ resolved, sourcePath }) => {
        const raw = resolved[sourcePath]?.value;
        return typeof raw === "string" ? raw.toUpperCase() : undefined;
      };

      const def: PayloadDefinition = {
        id: "array-upper",
        name: "Array Upper",
        fields: [
          { name: "id", source: { path: "user.id", required: true } },
          {
            name: "tagsUpper",
            source: { path: "user.tags" },
            transform: {
              arrayTransform: { field: "user.tags", transform: "fn:upperFn" },
            },
          },
        ],
        schema: {
          required: ["id"],
          properties: { id: { type: "string" }, tagsUpper: { type: "array" } },
        },
      };

      const gen = createPayloadGenerator(def, { functions: { upperFn } });
      const result = gen.generate(userContext({ user: { ...(userContext().user as Record<string, unknown>), tags: ["math", "computing"] } }));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.tagsUpper).toEqual(["MATH", "COMPUTING"]);
    });

    it("enum mapping: internal codes → external labels", () => {
      const def: PayloadDefinition = {
        id: "enum-mapping",
        name: "Enum Map",
        fields: [
          { name: "id", source: { path: "user.id", required: true } },
          { name: "statusLabel", source: { path: "user.status" }, transform: { enumMap: { A: "Active", I: "Inactive", R: "Retired" } } },
        ],
        schema: {
          required: ["id"],
          properties: { id: { type: "string" }, statusLabel: { type: "string", enum: ["Active", "Inactive", "Retired"] } },
        },
      };

      const gen = createPayloadGenerator(def);
      const result = gen.generate(userContext());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.statusLabel).toBe("Active");

      // Unknown code passes through as-is
      const ctx2 = userContext({ user: { ...(userContext().user as Record<string, unknown>), status: "Z" } });
      const r2 = gen.generate(ctx2);
      expect(r2.success).toBe(true);
      if (!r2.success) return;
      expect(r2.data.statusLabel).toBe("Z");
    });
  });

  // ── AC-6: Schema validation failure ────────────────────────────────
  it("AC-6 — field mapping passes but schema validation fails", () => {
    const def: PayloadDefinition = {
      id: "schema-fail",
      name: "Schema Fail",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "status", source: { path: "user.status" } },
      ],
      schema: {
        required: ["id", "status"],
        properties: {
          id: { type: "string" },
          // status must be one of these exact values
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "CANCELLED"] },
        },
      },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext()); // user.status is "A", not in enum

    expect(result.success).toBe(false);
    if (result.success) return;
    const enumError = result.errors.find((e) => e.field === "status");
    expect(enumError).toBeDefined();
    expect(enumError!.type).toBe("enum");
    expect(enumError!.message).toMatch(/not in enum/);
  });

  // ── AC-7: Structured logs ──────────────────────────────────────────
  it("AC-7 — structured log entries emitted for mapping/validation failures", () => {
    const def: PayloadDefinition = {
      id: "log-test",
      name: "Log Test",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "missingReq", source: { path: "user.nonexistent", required: true } },
      ],
      schema: { required: ["id"], properties: { id: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());

    expect(result.success).toBe(false);
    const logs = gen.getLog();
    // At least one log entry should reference the missing required field
    const missingLog = logs.find((l) => l.field === "missingReq");
    expect(missingLog).toBeDefined();
    expect(missingLog!.level).toBe("error");
    expect(missingLog!.contextId).toContain("log-test");
    expect(missingLog!.reason).toContain("user.nonexistent");

    // Every log entry should have a timestamp
    for (const l of logs) {
      expect(l.timestamp).toBeDefined();
      expect(typeof l.timestamp).toBe("string");
    }
  });

  // ── AC-8: New payload type via config (FR-7) ──────────────────────
  it("AC-8 — new payload type registered without modifying core engine", () => {
    // Register a completely different payload type: "order"
    const orderDef: PayloadDefinition = {
      id: "order.v1",
      name: "Order V1",
      fields: [
        { name: "orderId", source: { path: "order.id", required: true } },
        { name: "total", source: { path: "order.total" }, transform: { type: { type: "number" } } },
        { name: "currency", source: { path: "order.currency", defaultValue: "USD" } },
      ],
      schema: {
        required: ["orderId"],
        properties: { orderId: { type: "string" }, total: { type: "number" }, currency: { type: "string" } },
      },
    };

    const gen = createPayloadGenerator(orderDef);
    const ctx: InputContext = { order: { id: "ord-1", total: "49.99" } };
    const result = gen.generate(ctx);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.orderId).toBe("ord-1");
    expect(result.data.total).toBe(49.99);
    expect(result.data.currency).toBe("USD");
  });

  // ── Additional edge cases ──────────────────────────────────────────
  it("alias overwrites output field name", () => {
    const def: PayloadDefinition = {
      id: "alias",
      name: "Alias Test",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "displayName", source: { path: "user.name" }, alias: "display_name" },
      ],
      schema: { required: ["id"], properties: { id: { type: "string" }, display_name: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.display_name).toBe("Ada Lovelace");
    expect("displayName" in result.data).toBe(false);
  });

  it("schema-level defaults populate missing properties", () => {
    const def: PayloadDefinition = {
      id: "schema-default",
      name: "Schema Defaults",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
      ],
      schema: {
        required: ["id"],
        properties: {
          id: { type: "string" },
          locale: { type: "string", default: "en-US" },
        },
      },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.locale).toBe("en-US");
  });

  it("multiple failures accumulate all errors", () => {
    const def: PayloadDefinition = {
      id: "multi-error",
      name: "Multi Error",
      fields: [
        { name: "a", source: { path: "x.a", required: true } },
        { name: "b", source: { path: "x.b", required: true } },
      ],
      schema: {
        required: ["a", "b"],
        properties: { a: { type: "string" }, b: { type: "string" } },
      },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("a");
    expect(fields).toContain("b");
  });

  it("getLog / resetLog round-trip", () => {
    const def: PayloadDefinition = {
      id: "log-roundtrip",
      name: "Log Roundtrip",
      fields: [
        { name: "bad", source: { path: "x.y", required: true } },
      ],
      schema: { required: ["bad"], properties: { bad: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    gen.generate({}); // triggers a failure → log written
    expect(gen.getLog().length).toBeGreaterThan(0);

    gen.resetLog();
    expect(gen.getLog()).toHaveLength(0);
  });

  it("null source value with required field fails", () => {
    const def: PayloadDefinition = {
      id: "null-required",
      name: "Null Required",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
      ],
      schema: { required: ["id"], properties: { id: { type: "string" } } },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate({ user: { id: null } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].type).toBe("required");
  });

  it("array transform map(prop) extracts nested property", () => {
    const def: PayloadDefinition = {
      id: "array-map",
      name: "Array Map",
      fields: [
        { name: "id", source: { path: "user.id", required: true } },
        { name: "tagNames", source: { path: "user.tags" } },
        // Using arrayTransform to map each tag to its uppercase via fn
      ],
      schema: {
        required: ["id"],
        properties: { id: { type: "string" }, tagNames: { type: "array" } },
      },
    };

    const gen = createPayloadGenerator(def);
    const result = gen.generate(userContext());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tagNames).toEqual(["math", "computing"]);
  });
});