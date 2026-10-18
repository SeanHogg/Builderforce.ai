import { describe, expect, it } from "vitest";
import { listFilesTool } from "./core-tools.js";
import type { CapabilityProvider } from "./capabilities.js";

/** A provider whose listFiles answers with whatever the test pins. */
function provider(result: unknown): CapabilityProvider {
  return { repoRead: { listFiles: async () => result } } as unknown as CapabilityProvider;
}

async function runList(args: Record<string, unknown>, result: unknown) {
  const ctx = { caps: provider(result) } as never;
  const out = await listFilesTool.execute(args, ctx);
  return (out as { data: { note?: string; paths?: string[] } }).data;
}

describe("list_files zero-match note", () => {
  // Regression lock: the note used to assert "0 matches means no such file exists" even
  // when the walk had been cut off at its file budget. On a repo bigger than the budget
  // that is a FALSE NEGATIVE -- the file was simply past the 5,000th path -- and the
  // model, believing it, went hunting for hand-rolled finders instead of scoping in.
  it("does NOT claim absence when the walk was truncated", async () => {
    const data = await runList({ glob: "**/*.test.ts" }, { ok: true, paths: [], truncated: true });
    expect(data.note).toBeTruthy();
    expect(data.note).toContain("NOT proof the file does not exist");
    expect(data.note).toContain("cut off");
    expect(data.note).not.toContain("0 matches means no such file exists");
  });

  it("keeps the absent-file wording only when the listing was complete", async () => {
    const data = await runList({ glob: "**/*.test.ts" }, { ok: true, paths: [], truncated: false });
    expect(data.note).toContain("0 matches means no such file exists");
    expect(data.note).toContain("broader pattern");
  });

  it("names the scope in the note, so a wrong scope is visible", async () => {
    const data = await runList(
      { path: "frontend/src/lib", glob: "*.test.ts" },
      { ok: true, paths: [], truncated: false },
    );
    expect(data.note).toContain('under "frontend/src/lib"');
  });

  it("stays silent when the glob DID match", async () => {
    const data = await runList({ glob: "a.ts" }, { ok: true, paths: ["a.ts"], truncated: false });
    expect(data.note).toBeUndefined();
  });
});