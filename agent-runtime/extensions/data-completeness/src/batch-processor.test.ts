/**
 * Unit Tests for Batch Processing Support
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  FieldWeightConfig,
  PlaceholderConfig,
  ScoreThresholds,
} from "./types.js";
import {
  batchScoreRecords,
  IncrementalMetricsCollector,
} from "./batch-processor.js";
import {
  calculateRecordScore,
} from "./scoring-engine.js";
import type { RecordScoreData } from "./types.js";

describe("Batch Processing Support", () => {
  describe("IncrementalMetricsCollector", () => {
    const fieldWeights: FieldWeightConfig = { name: 1, email: 2, phone: 1 };
    const placeholders: PlaceholderConfig = ["N/A", "null", ""];
    const thresholds: ScoreThresholds = {
      critical: 50,
      warning: 50,
      passing: 80,
    };

    it("should initialize with zero metrics", () => {
      const collector = new IncrementalMetricsCollector(
        fieldWeights,
        placeholders,
        thresholds
      );
      const stats = collector.getStats();
      expect(stats.totalRecords).toBe(0);
      expect(stats.sumScores).toBe(0);
      expect(stats.minScore).toBe(0);
      expect(stats.maxScore).toBe(0);
      expect(stats.avgScore).toBe(0);
    });

    it("should process records and update metrics correctly", () => {
      const collector = new IncrementalMetricsCollector(
        fieldWeights,
        placeholders,
        thresholds
      );

      collector.processRecord({ name: "Alice", email: "alice@example.com", phone: "123-456-7890" });
      collector.processRecord({ name: null, email: "", phone: "987-654-3210" });
      collector.processRecord({ name: "Bob", email: "bob@example.com", phone: null });

      const stats = collector.getStats();

      expect(stats.totalRecords).toBe(3);
      expect(stats.sumScores).toBeCloseTo(266.67, 2); // (100 + 0 + 166.67)
      expect(stats.minScore).toBe(0);
      expect(stats.maxScore).toBe(100);
      expect(stats.avgScore).toBeCloseTo(88.89, 2);
    });

    it("should handle large record counts without errors", () => {
      const collector = new IncrementalMetricsCollector(
        fieldWeights,
        placeholders,
        thresholds
      );

      for (let i = 0; i < 10_000; i++) {
        const record = {
          name: i % 2 === 0 ? `User${i}` : null,
          email: i % 3 === 0 ? `user${i}@example.com` : "",
          phone: i % 4 === 0 ? "123-456-7890" : null,
        };
        collector.processRecord(record);
      }

      const stats = collector.getStats();
      expect(stats.totalRecords).toBe(10_000);
      expect(stats.avgScore).toBeGreaterThan(0);
      expect(stats.avgScore).toBeLessThan(100);
    });

    it("should finalize with dummy report when no records processed", () => {
      const collector = new IncrementalMetricsCollector(
        fieldWeights,
        placeholders,
        thresholds
      );

      const report = collector.finalize();

      expect(report.overallScore).toBe(0);
      expect(report.minScore).toBe(0);
      expect(report.maxScore).toBe(0);
      expect(report.stdDev).toBe(0);
      expect(report.summary.criticalCount).toBe(0);
      expect(report.summary.warningCount).toBe(0);
      expect(report.summary.passingCount).toBe(0);
      expect(report.summary.avgScore).toBe(0);
    });

    it("should track completion status of fields correctly", () => {
      const collector = new IncrementalMetricsCollector(
        fieldWeights,
        placeholders,
        thresholds
      );

      const records = [
        { name: "A", email: "a@example.com", phone: "123" },
        { name: null, email: "b@example.com", phone: "456" },
        { name: "C", email: null, phone: "789" },
      ];

      for (const record of records) {
        collector.processRecord(record);
      }

      const report = collector.finalize();
      // name: 2/3 (66.7%)
      expect(report.perFieldCompleteness.name.completionRate).toBeCloseTo(66.7, 1);
      // email: 2/3 (66.7%)
      expect(report.perFieldCompleteness.email.completionRate).toBeCloseTo(66.7, 1);
      // phone: 3/3 (100%)
      expect(report.perFieldCompleteness.phone.completionRate).toBe(100);
    });
  });

  describe("batchScoreRecords async generator", () => {
    it("should yield scored records incrementally", async () => {
      const records = [
        { product: "abc", price: 10, qty: 5 },
        { product: null, price: 20, qty: 10 },
        { product: "def", price: 15, qty: null },
      ];

      const fieldWeights = { product: 1, price: 1, qty: 1 };
      const result = [];

      for await (const scored of batchScoreRecords(records, fieldWeights, [], {
        critical: 50,
        warning: 50,
        passing: 80,
      })) {
        result.push(scored);
      }

      expect(result.length).toBe(3);
      expect(result[0].scoreData.tier).toBe("passing");
      expect(result[0].scoreData.tier).toBe("passing");
      // Check score is 66.67: (2*1)/(3*1)*100 for second record (product null)
      expect(result[1].scoreData.score).toBe(66.67);
    });

    it("should throw on invalid record type", async () => {
      const records = [{} as any, { name: "A" }];

      const fieldWeights = { name: 1 };
      let threw = false;

      try {
        for await (const _scored of batchScoreRecords(records, fieldWeights, [], {
          critical: 50,
          warning: 50,
          passing: 80,
        })) {
          // Should not reach iterator body
        }
      } catch (e) {
        threw = true;
        expect((e as Error).message).toContain("Each record must be a valid JSON object");
      }

      expect(threw).toBe(true);
    });

    it("should validate and reject invalid field weights", async () => {
      const records = [{ name: "A", email: "a@b.com" }];
      const invalidFieldWeights = { name: -1, email: 1 };

      let threw = false;

      try {
        for await (const _scored of batchScoreRecords(records, invalidFieldWeights, [], {
          critical: 50,
          warning: 50,
          passing: 80,
        })) {
          throw new Error("Should not reach generator");
        }
      } catch (e) {
        threw = true;
        expect((e as Error).message).toContain("Invalid field weights provided");
      }

      expect(threw).toBe(true);
    });
  });

  describe("batch stress test", () => {
    it("should handle large batches efficiently without blocking", async () => {
      const records = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        value: i % 10 === 0 ? null : `val${i}`,
      }));

      const fieldWeights = { id: 1, value: 1 };
      let count = 0;
      const startTime = performance.now();

      for await (const scored of batchScoreRecords(records, fieldWeights, [], {
        critical: 50,
        warning: 50,
        passing: 80,
      })) {
        count++;
        if (count >= records.length) break;
      }

      const elapsed = performance.now() - startTime;
      console.log(`processing 5000 records in ${elapsed.toFixed(2)}ms`);
      expect(count).toBe(5000);
      // This is not a hard performance assertion, just a reference point
    });
  });
});