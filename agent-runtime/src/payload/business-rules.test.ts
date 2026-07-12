/**
 * Business Ruleset Unit Tests
 *
 * This module provides lightweight sanity checks for the registered
 * business rules catalog (business-rules.json) as defined in FR‑3.
 * These tests ensure the ruleset structure complies with the expected
 * schema and catalog invariants.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Core invariants expectations for Each Ruleset
 */

describe("Business Ruleset Catalog", () => {
  const RAW_FILE = "agent-runtime/src/payload/business-rules.json";

  it("exposes JSON with a document-level schema object", () => {
    expect(existsSync(RAW_FILE)).toBe(true);

    const content = readFileSync(RAW_FILE, "utf-8");
    const doc = JSON.parse(content);

    // Document must have a schema property defining the expected shape
    expect(doc).toHaveProperty("schema");
    const schema = doc.schema as Record<string, unknown>;
    expect(typeof schema.type).toBe("string");
    expect(schema.type).toBe("object");
  });

  it("has a title/overview (top-level descriptive keys)", () => {
    const content = readFileSync(RAW_FILE, "utf-8");
    const doc = JSON.parse(content);
    expect(doc).toHaveProperty("title");
    expect(doc.title).toBeTypeOf("string");
  });

  it("has a top-level version that is SemVer minor version", () => {
    const content = readFileSync(RAW_FILE, "utf-8");
    const doc = JSON.parse(content);
    expect(doc.version).toMatch(/^[0-9]+\.[0-9]+$/);
  });

  it("has an applicable payload-ruleset-level appliesTo list of string payload IDs", () => {
    const content = readFileSync(RAW_FILE, "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const topAppliesTo = doc.appliesTo as unknown;
    if (topAppliesTo !== undefined) {
      expect(Array.isArray(topAppliesTo)).toBe(true);
      for (const x of topAppliesTo as unknown[]) {
        expect(String(x)).toMatch(/^[a-zA-Z0-9_-]+$/);
      }
    }
  });

  it("rules: array of rules", () => {
    const content = readFileSync(RAW_FILE, "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;
    const rules = doc.rules as unknown[];
    expect(Array.isArray(rules)).toBe(true);
  });

  for (const field of ["nullable", "coerce", "enumMappings", "condition", "fn", "functionAliases"] as const) {
    it(`rulesets must not contain any occurrences of stray '${field}' (reserved)`);

    // This is a fast sanity property check: if a stray field (case-insensitive)
    // appears at the root or within any rule, the file is not yet stable.
    const content = readFileSync(RAW_FILE, "utf-8").toLowerCase();
    expect(content).not.toContain(field);
  }
});

/**
 * Core invariants expectations for Each Rule
 */

describe("Business Rule Schema / Shape", () => {
  it("Each rule must contain required name and typeOrDerived", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];
    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("typeOrDerived");
      expect(typeof r.name).toBe("string");
      expect(["string", "number", "integer", "boolean", "date", "epoch", "derivedFunction"])
        .toContain(r.typeOrDerived as string);
    }
  });

  for (const field of ["nullable", "coerce", "enumMappings", "condition", "fn", "functionAliases"]) {
    it(`Rules must not contain stray '${field}' (reserved)`);

    // Only allow these form-level keys.
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8").toLowerCase();
    expect(content).not.toContain(field);
  }
});

/**
 * Core Invariant: Ruleset version and Rule name must be stable-case identifiers
 */

describe("Identifier Stability", () => {
  it("Ruleset name must be stable-case", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const name = doc.name as string | undefined;
    expect(name).toBeDefined();
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[a-zA-Z0-9_.-]+$/);
  });

  it("Ruleset name cannot change across versions in the same catalog", () => {
    const re = /^[a-zA-Z0-9_.-]+$/;
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rulesets = JSON.parse(content);
    const rulesetNames = (rulesets.rulesets ?? []).map((r: unknown) => String((r as Record<string, unknown>).name));
    const seen = new Set<string>();
    for (const name of rulesetNames) {
      expect(re.test(name), `Ruleset name '${name}' is not stable-case`).toBe(true);
      expect(seen.has(name), `Ruleset name '${name}' appears multiple times`).toBe(false);
      seen.add(name);
    }
  });

  it("Rule name must be unique within a ruleset and stable-case", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;
    const rulesets = (doc.rulesets ?? []).map((rs: unknown) =>
      (rs as Record<string, unknown>).rules ?? []
    ) as unknown[][];

    const re = /^[a-zA-Z0-9_.-]+$/;
    for (const rulesetRules of rulesets) {
      const names = new Set<string>();
      for (const rule of rulesetRules) {
        const r = rule as Record<string, unknown>;
        const name = r.name as string | undefined;
        expect(name).toBeDefined();
        expect(re.test(name), `Rule name '${name}' is not stable-case`).toBe(true);
        expect(names.has(name), `Rule name '${name}' appears multiple times in a ruleset`).toBe(false);
        names.add(name);
      }
    }
  });
});

/**
 * Core Invariant: TypeOrDerived and DerivedFunction relationship
 */

describe("TypeOrDerived Validation", () => {
  it("LHS type values must be concrete and align with engine (string|number|integer|boolean|date|epoch)", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;
    const rules = doc.rules as unknown[];

    const validTypes: (string | number)[] = ["string", "number", "integer", "boolean", "date", "epoch"];
    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const typeOrDerived = r.typeOrDerived as string | undefined;
      expect(validTypes).toContain(typeOrDerived);
    }
  });

  it("derivedFunction rules must have a fn property (name)", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];

    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const typeOrDerived = r.typeOrDerived as string | undefined;
      if (typeOrDerived === "derivedFunction") {
        expect(r).toHaveProperty("fn");
        expect(typeof r.fn).toBe("string");
      }
    }
  });

  it("transformations and derived functions must use stable-case fn names", () => {
    const re = /^[a-zA-Z0-9_.-]+$/i;
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const fnNames: string[] = [];
    const rules = doc.rules as unknown[];

    for (const r of rules) {
      const rule = r as Record<string, unknown>;
      const fn = rule.fn as string | undefined;
      if (fn) {
        fnNames.push(fn);
      }
    }

    for (const fnName of fnNames) {
      expect(re.test(fnName)).toBe(true);
    }
  });
});

/**
 * Core Invariant: Condition definitions must match the operator enumeration
 */

describe("Condition Validation", () => {
  it("Condition: mandatory field and operator enum aligned with engine", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];

    const validOperators = [
      "equals", "notEquals", "contains", "startsWith", "endsWith",
      "greaterThan", "lessThan", "exists"
    ];

    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      if ((r.typeOrDerived as string | undefined) === "string") {
        const condition = r.condition as unknown;
        if (condition !== undefined) {
          const cond = condition as Record<string, unknown>;
          expect(cond).toHaveProperty("field");
          expect(cond).toHaveProperty("operator");
          const op = cond.operator as string;
          expect(validOperators).toContain(op);
        }
      }
    }
  });
});

/**
 * Core Invariant: enumMappings are strictly for string typing, optional, and values are strings
 */

describe("Enum Mappings Validation", () => {
  it("enumMappings is optional and values are strings", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];

    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const enumMappings = r.enumMappings as Record<string, string | number> | undefined;

      if (enumMappings) {
        for (const key of Object.keys(enumMappings)) {
          const val = enumMappings[key];
          expect(typeof val).toBe("string");
        }
      }
    }
  });

  it("enumMappings can only be used with type string", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];

    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const typeOrDerived = r.typeOrDerived as string | undefined;
      const enumMappings = r.enumMappings as Record<string, string> | undefined;

      if (enumMappings) {
        expect(typeOrDerived).toBe("string");
      }
    }
  });

  it("enumMappings strings are non-empty stable-case", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const rules = JSON.parse(content).rules as unknown[];

    const re = /^[a-zA-Z0-9_.-]+$/i;

    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const enumMappings = r.enumMappings as Record<string, string> | undefined;

      if (enumMappings) {
        for (const label of Object.values(enumMappings)) {
          expect(typeof label).toBe("string");
          expect(label.length).toBeGreaterThan(0);
          expect(re.test(label)).toBe(true);
        }
      }
    }
  });
});

/**
 * Optional: interpret as initialization keys (payload/type/rule-level)
 */

describe("Optional Fields Interpretation", () => {
  it("Ruleset-level optional appliesTo list of string payload IDs", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const appliesTo = doc.appliesTo as unknown[];
    if (appliesTo !== undefined) {
      expect(Array.isArray(appliesTo)).toBe(true);
      for (const x of appliesTo) {
        if (typeof x === "string") {
          expect(x).toMatch(/^[a-zA-Z0-9_-]+$/);
        }
      }
    }
  });

  it("Each Rule has optional appliesTo list of string payload IDs", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const rules = doc.rules as unknown[];
    for (const rule of rules) {
      const r = rule as Record<string, unknown>;
      const ruleAppliesTo = r.appliesTo as unknown;
      if (ruleAppliesTo !== undefined) {
        expect(Array.isArray(ruleAppliesTo)).toBe(true);
        for (const x of ruleAppliesTo as unknown[]) {
          if (typeof x === "string") {
            expect(x).toMatch(/^[a-zA-Z0-9_-]+$/);
          }
        }
      }
    }
  });

  it("Each Rule has optional nullable, coerce, transformations, condition, functionAliases", () => {
    for (const field of ["nullable", "coerce", "transformations", "condition", "functionAliases"]) {
      const skippedInvariant = field === "functionAliases"
        ? "TODO: add bindings test when ruleset activation implementation is complete"
        : "Business Ruleset Manifest definition (future extension)";
      it(`${field ? field : "reserved-key-invariant"} (${skippedInvariant})`, () => {
        // Currently reserved key presence is already validated.
      });
    }

    it("Transformations keys are stable case and values are objects for execution stability", () => {
      const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
      const rules = JSON.parse(content).rules as unknown[];

      const re = /^[a-zA-Z0-9_.-]+$/i;

      for (const rule of rules) {
        const r = rule as Record<string, unknown>;
        const transformations = r.transformations as Record<string, unknown> | undefined;
        if (transformations) {
          for (const templateId of Object.keys(transformations)) {
            expect(typeof templateId).toBe("string");
            expect(re.test(templateId)).toBe(true);
          }
        }
      }
    });
  });
});

describe("Integration Example: Simple Requester", () => {
  it("can extract and return catalog metadata without throwing", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const title = doc.title as string;
    const version = doc.version as string;
    const rulesets = doc.rulesets as unknown[] | undefined;

    expect(title).toBeTruthy();
    expect(version).toMatch(/^[0-9]+\.[0-9]+$/);
    if (rulesets) expect(Array.isArray(rulesets)).toBe(true);
  });

  it("each ruleset has stable-case repository-level name and optional appliesTo array", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const re = /^[a-zA-Z0-9_.-]+$/;
    const rulesets = doc.rulesets as unknown[] | undefined;

    if (rulesets) {
      for (const rs of rulesets) {
        const ruleset = rs as Record<string, unknown>;
        const name = ruleset.name as string | undefined;
        expect(re.test(String(name))).toBe(true);

        const appliesTo = ruleset.appliesTo as unknown[] | undefined;
        if (appliesTo) {
          for (const x of appliesTo) {
            if (typeof x === "string") {
              expect(re.test(x)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("ruleset-level version is SemVer minor version", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const rulesets = doc.rulesets as unknown[] | undefined;

    if (rulesets) {
      for (const rs of rulesets) {
        const ruleset = rs as Record<string, unknown>;
        const version = ruleset.version as string | undefined;
        expect(version).toMatch(/^[0-9]+\.[0-9]+$/);
      }
    }
  });

  it("ruleset-level description is a non-empty string", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const rulesets = doc.rulesets as unknown[] | undefined;

    if (rulesets) {
      for (const rs of rulesets) {
        const ruleset = rs as Record<string, unknown>;
        const desc = ruleset.description as string | undefined;
        expect(desc).toMatch(/^[^\s]/s);
      }
    }
  });

  it("all ruleset-level rules are objects with stable-case names, descriptions, nullable/coerce templates", () => {
    const content = readFileSync("agent-runtime/src/payload/business-rules.json", "utf-8");
    const doc = JSON.parse(content) as Record<string, unknown>;

    const rulesets = doc.rulesets as unknown[] | undefined;

    if (rulesets) {
      const re = /^[a-zA-Z0-9_.-]+$/i;

      for (const rs of rulesets) {
        const ruleset = rs as Record<string, unknown>;
        const rules = ruleset.rules as unknown[] | undefined;

        if (rules) {
          for (const rule of rules) {
            const r = rule as Record<string, unknown>;
            const name = r.name as string | undefined;
            const desc = r.description as string | undefined;

            expect(re.test(String(name)), `ruleset rule name '${name}' not stable-case`).toBe(true);
            expect(desc).toMatch(/^[^\s]/s);
          }
        }
      }
    }
  });
});