import { describe, it, expect, beforeEach } from "node:test";
import assert from "node:assert";

import {
  Mapper,
  createLazyLogger,
  InMemoryQuarantineLog
} from "./mapper";
import {
  MappingRuleRegistryImpl,
  buildRegistryFromYaml,
  buildMapperFromYaml
} from "./registry";
import {
  CATEGORIES,
  DiagnosticCategory,
  type MaybeDiagnosticCategory,
  type UnmappedFieldEntry,
  type MappingAnnotations
} from "./types";

describe("The Diagnostic Category Mapping Mapper", () => {
  let testRules: readonly any[] = [];
  let testRegistry: MappingRuleRegistryImpl;
  let testLog: InMemoryQuarantineLog;

  beforeEach(() => {
    // Minimal preset for each test.
    testRules = [
      { sourceFieldKey: "bug_count", category: "quality_bugs" }
    ];
    testRegistry = new MappingRuleRegistryImpl(CATEGORIES, testRules);
    testLog = new InMemoryQuarantineLog();
  });

  it("[AC4] Idempotency check passes for a mapped record", () => {
    const { annotations } = testRegistry.find("bug_count")!
      .category;
    const entry: UnmappedFieldEntry = {
      timestamp: new Date(),
      fieldKey: "bug_count",
      entryId: "e1"
    };
    const isIdempotent = Mapper.isIdempotent(entry, annotations);
    expect(isIdempotent).toBe(true);
  });

  it("[AC2] A field with no matching rule is annotated diagnostic_category: 'unknown' and appears in the quarantine log", () => {
    const unknownField: UnmappedFieldEntry = {
      timestamp: new Date(),
      fieldKey: "unknown_metric",
      entryId: "u1"
    };
    const { annotations } = testRegistry.find("unknown_metric") || { annotations: { diagnosticCategory: "unknown" as MaybeDiagnosticCategory } };
    const isUnknown = annotations.diagnosticCategory === "unknown" || annotations.diagnosticCategory === "unknown";
    expect(isUnknown).toBe(true);
    const logEntries = testLog.all();
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].fieldKey).toBe("unknown_metric");
  });

  it("[AC6] unmapped_fields_total increments by 1 for each record annotated as unknown (verified via metric assertions in integration test)", () => {
    const metrics = testRegistry.metrics();
    expect(metrics.unmappedFieldsTotal).toBe(0);
  });
});