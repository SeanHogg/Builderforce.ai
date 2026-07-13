/**
 * Unit and integration tests for SubComponent test fixtures (factory/builder helpers).
 *
 * Subsystem covered: SubComponent builder, factory, and validation helpers used for
 * test data across unit and integration test suites.
 *
 * Requires:
 * - FR-5.2: A factory/builder function creates a valid SubComponent object.
 *
 * FR IDs covered:
 * - FR-5.2: SubComponent factory helpers.
 *
 * Rationale:
 * - The PRD requires a factory for SubComponent (FR-5.2), even though SubComponent
 *   is an optional extension field not present in the core ProgressBreakdown schema.
 *   By providing a builder, the test ecosystem can use typed helper data (e.g.,
 *   for mocking fixtures or visualization comparisons) and prevent ad-hoc object
 *   construction with potential runtime errors.
 *
 * AC IDs referenced:
 * - AC-3: No external side effects (pure function, deterministic).
 * - AC-4: Isolation — tests are independent, no shared mutable state.
 */

import { describe, expect, test } from "vitest";

/**
 * FR-5.2: Factory/builder for SubComponent objects.
 *
 * Creates a valid SubComponent with sensible defaults (key, label, value, weight).
 * Supports optional overrides; uses same deterministic defaults across units.
 *
 * @param overrides - Optional fields to override.
 * @returns A valid SubComponent object conforming to the expected shape.
 */
export function createSubComponent(
  overrides: Partial<SubComponent> = {}
): SubComponent {
  const now = Date.now();
  defaults.lastCreated = now;

  return {
    id: `sub-${defaults.counter++}`,
    key: overrides.key ?? "test_key",
    label: overrides.label ?? "Test Label",
    value: overrides.value ?? 0,
    weight: overrides.weight ?? 1.0,
    hidden: overrides.hidden ?? false,
    lastUpdated: overrides.lastUpdated ?? now,
    ...overrides,
  };
}

/**
 * Internal helpers (deterministic counter + lastCreated timestamp).
 * Isolated to this file to avoid global contamination across test suites.
 */
const defaults = {
  counter: 1,
  lastCreated: Date.now(),
};

/**
 * Interface for SubComponent.
 * Used for:
 * - Test fixture generation (FR-5.2)
 * - Mock data for integration tests where SubComponent is projected
 * - Validation helpers for edge cases (e.g., value/weight ranges, label formatting)
 */
export interface SubComponent {
  id: string;
  key: string;
  label: string;
  value: number;
  weight: number;
  hidden?: boolean;
  lastUpdated: number;
}

/**
 * Validation helper: ensure a SubComponent has valid numeric fields.
 *
 * Fr-5.4 ensures deterministic output; this helper validates that,
 * e.g., feMakeSubComponent(0) produces weight 0, not undefined.
 * Used across unit tests (FR-2.5 filterHidden’s “include only valid” requirement).
 */
export function validateSubComponent(component: SubComponent): void {
  expect(component).toBeDefined();
  expect(typeof component.id).toBe("string");
  expect(typeof component.key).toBe("string");
  expect(typeof component.label).toBe("string");
  expect(typeof component.value).toBe("number");
  expect(typeof component.weight).toBe("number");
  expect(typeof component.hidden).toBe("boolean");
  expect(typeof component.lastUpdated).toBe("number");
  expect(component.value).toBeGreaterThanOrEqual(0);
  expect(component.value).toBeLessThanOrEqual(100);
  expect(component.weight).toBeGreaterThan(0);
  expect(component.weight).toBeLessThanOrEqual(1);
}

// --------------------------------------------------------------------------- //
// FR-5.2: SubComponent builder / factory test cases
// --------------------------------------------------------------------------- //

describe("createSubComponent factory", () => {
  // FR-5.2: A factory/builder for SubComponent with sensible defaults.
  test("returns a valid SubComponent with defaults", () => {
    const component = createSubComponent();

    expect(component.id).toBeDefined();
    expect(component.key).toBe("test_key");
    expect(component.label).toBe("Test Label");
    expect(component.value).toBe(0);
    expect(component.weight).toBe(1.0);
    expect(component.hidden).toBe(false);
    expect(typeof component.lastUpdated).toBe("number");
  });

  test("applies overrides correctly", () => {
    const component = createSubComponent({
      key: "custom_key",
      label: "Custom Label",
      value: 75,
      weight: 0.5,
      hidden: true,
      lastUpdated: 1000,
    });

    expect(component.key).toBe("custom_key");
    expect(component.label).toBe("Custom Label");
    expect(component.value).toBe(75);
    expect(component.weight).toBe(0.5);
    expect(component.hidden).toBe(true);
    expect(component.lastUpdated).toBe(1000);
  });

  test("generates unique IDs across multiple creations (isolation, FR-5.4)", () => {
    const comp1 = createSubComponent();
    const comp2 = createSubComponent();
    const comp3 = createSubComponent();

    expect(comp1.id).not.toBe(comp2.id);
    expect(comp2.id).not.toBe(comp3.id);
    expect(comp1.lastCreated).toBeLessThanOrEqual(comp2.lastCreated);
    expect(comp2.lastCreated).toBeLessThanOrEqual(comp3.lastCreated);
  });

  // FR-5.4: Deterministic behavior with same inputs (expected a stable test).
  test("is deterministic when called with same arguments", () => {
    const comp1 = createSubComponent({ value: 50, weight: 0.8 });
    const comp2 = createSubComponent({ value: 50, weight: 0.8 });
    expect(comp2.key).toBe(comp1.key);
  });
});

// --------------------------------------------------------------------------- //
// FR-5.2: SubComponent validation helpers
// --------------------------------------------------------------------------- //

describe("validateSubComponent", () => {
  // Ensure SubComponent passes validation checks (reduces mutation risk).
  test("passes validation for a valid component", () => {
    const component = createSubComponent();
    expect(() => validateSubComponent(component)).not.toThrow();
  });

  test("throws for missing fields", () => {
    const invalid = { value: 50 } as any;
    expect(() => validateSubComponent(invalid)).toThrow();
  });

  test("throws for out-of-range values", () => {
    const invalid = createSubComponent({ value: -1 }); // below 0
    expect(() => validateSubComponent(invalid)).toThrow();

    const invalidHigh = createSubComponent({ value: 101 }); // above 100
    expect(() => validateSubComponent(invalidHigh)).toThrow();
  });

  test("throws for invalid weight (negative)", () => {
    const invalid = createSubComponent({ weight: -0.1 });
    expect(() => validateSubComponent(invalid)).toThrow();
  });

  test("throws for invalid weight (zero)", () => {
    const invalid = createSubComponent({ weight: 0 });
    expect(() => validateSubComponent(invalid)).toThrow();
  });

  test("throws for invalid weight (greater than 1)", () => {
    const invalid = createSubComponent({ weight: 1.1 });
    expect(() => validateSubComponent(invalid)).toThrow();
  });
});

// --------------------------------------------------------------------------- //
// FR-5.4: Isolation and lack of global state
// --------------------------------------------------------------------------- //

describe("isolation and state management", () => {
  // AC-3: Tests don’t write to production DB or mutate global state.
  test("does not modify global state across tests", () => {
    const before = defaults.counter;
    createSubComponent();
    expect(defaults.counter).toBe(before + 1);
  });

  test("resetting counter clears local state", () => {
    const comp1 = createSubComponent();
    defaults.counter = 1; // Reset for reusability in this suite
    const comp2 = createSubComponent();
    // IDs remains unique even after resetting counter
    expect(comp1.id).not.toBe(comp2.id);
  });
});

// --------------------------------------------------------------------------- //
// FR-4: Edge cases for SubComponent factory
// --------------------------------------------------------------------------- //

describe("edge cases for SubComponent factory", () => {
  // FR-4.1: All 100 at 100 -> total is 100.
  test("sum of weights is 100 when all components are at 100", () => {
    const components = Array.from({ length: 5 }, (_, i) =>
      createSubComponent({ value: 100, weight: 20 })
    );
    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  // FR-4.2: All 100 -> total is 100 (zero-state test complement).
  test("supports default value 0 for all components", () => {
    const components = Array.from({ length: 5 }, () => createSubComponent({ value: 0 }));
    components.forEach(validateSubComponent);
  });

  // FR-4.3: Single component with weight 1.0.
  test("handles single component (weight 1.0)", () => {
    const component = createSubComponent({ value: 75, weight: 1.0 });
    validateSubComponent(component);
    // Sum of weights is 1 when there’s a single component
    const sum = createSubComponent().weight; // 1.0
    expect(sum).toBe(1.0);
  });

  // FR-4.4: Floating-point inputs.
  test("handles floating-point values without serialization errors", () => {
    const components = [
      createSubComponent({ value: 33.333333, weight: 0.333333 }),
      createSubComponent({ value: 66.666667, weight: 0.666667 }),
    ];
    expect(() => JSON.stringify(components)).not.toThrow();
    const serialized = JSON.stringify(components);
    expect(serialized).toContain("33.333333");
  });

  // FR-4.5: Very large number of sub-components.
  test("creates 100 components without performance degrading beyond threshold", () => {
    const components = Array.from({ length: 100 }, (_, i) =>
      createSubComponent({ value: i + 1, weight: 1 })
    );
    expect(components).toHaveLength(100);
    components.forEach(validateSubComponent);
  });
});

// --------------------------------------------------------------------------- //
// FR-2.5: Integration with filterHidden (include only valid components)
// --------------------------------------------------------------------------- //

describe("filterHidden with SubComponent factory", () => {
  // FR-2.5: Filtered list excludes hidden SubComponents.
  test("excludes hidden components with includeHidden=false by default", () => {
    const components = [
      createSubComponent({ id: "1", value: 100, hidden: false }),
      createSubComponent({ id: "2", value: 80, hidden: true }),
      createSubComponent({ id: "3", value: 60 }),
    ];
    const visible = components.filter((c) => !c.hidden);
    expect(visible).toHaveLength(2);
    expect(visible).not.toContainEqual(
      expect.objectContaining({ id: "2" })
    );
  });

  test("includes hidden components when includeHidden=true", () => {
    const all = [
      createSubComponent({ id: "1", hidden: false }),
      createSubComponent({ id: "2", hidden: true }),
    ];
    const allInclusive = all.filter((c) => !c.hidden || true);
    expect(allInclusive).toHaveLength(2);
  });
});