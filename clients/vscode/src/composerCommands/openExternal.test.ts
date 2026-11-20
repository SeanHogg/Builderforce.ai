import { describe, expect, it, vi } from "vitest";
import { openUrlVerbatim } from "./openExternal";

describe("opening the launcher URL", () => {
  it("hands the editor the launcher's URL string byte for byte, its #token fragment intact", async () => {
    // A token with characters `Uri.parse(...).toString()` would re-encode (`=` → `%3D`, `%` → `%25`).
    const url = "https://localhost:4123/#token=Ab9_-x%2Fy=z&env=staging";
    const openExternal = vi.fn(async (_target: unknown) => true);
    await openUrlVerbatim(openExternal)(url);
    expect(openExternal).toHaveBeenCalledOnce();
    const passed = openExternal.mock.calls[0]![0];
    expect(typeof passed).toBe("string");
    expect(passed).toBe(url);
  });
});
