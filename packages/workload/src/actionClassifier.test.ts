import { describe, expect, it } from "vitest";
import { classifyRunAction, MIN_CONFIDENCE } from "./actionClassifier.js";

describe("classifyRunAction", () => {
  it("labels obvious work with the shared taxonomy's bucket", () => {
    expect(
      classifyRunAction("Fix the bug where the parser crashes on empty input").actionType,
    ).toBe("bugfix");
    expect(classifyRunAction("Add unit tests for the auth service with vitest").actionType).toBe(
      "tests",
    );
    expect(
      classifyRunAction("Write a SQL migration: create table invoices with a foreign key")
        .actionType,
    ).toBe("sql");
    expect(classifyRunAction("Update the README and the changelog documentation").actionType).toBe(
      "docs",
    );
    expect(
      classifyRunAction("Refactor the handler: extract a helper and deduplicate").actionType,
    ).toBe("refactor");
    expect(classifyRunAction("Backfill the data migration for archived rows").actionType).toBe(
      "data_migration",
    );
  });

  it("falls back to `other` rather than guessing when there is no signal", () => {
    expect(classifyRunAction("hello").actionType).toBe("other");
    expect(classifyRunAction("").actionType).toBe("other");
    expect(classifyRunAction(undefined)).toEqual({ actionType: "other", confidence: 0 });
  });

  it("a mislabel is worse than the fallback: split evidence resolves to `other`", () => {
    // Deliberately mixes three vocabularies so no bucket can clear the floor.
    const verdict = classifyRunAction(
      "Refactor the SQL query, document it in the README, and deploy via the CI pipeline to kubernetes",
    );
    expect(verdict.confidence).toBeLessThan(MIN_CONFIDENCE);
    expect(verdict.actionType).toBe("other");
  });

  it("pasted context is discounted, so a repository's vocabulary cannot decide the label", () => {
    // The shape of a real agent prompt: an instruction, a blank line, then a wall of
    // pasted files whose words describe the CODEBASE and not the work.
    const noise = "database schema sql query postgres\n".repeat(400);
    expect(
      classifyRunAction(`Fix the crashing bug in the parser.

${noise}`).actionType,
    ).toBe("bugfix");
  });

  it("is deterministic", () => {
    const prompt = "Add integration tests for the deploy pipeline";
    expect(classifyRunAction(prompt)).toEqual(classifyRunAction(prompt));
  });
});
