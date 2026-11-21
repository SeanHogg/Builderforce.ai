import { describe, expect, it, vi } from "vitest";
import { INTEGRATED_BROWSER_OPEN, integratedBrowser, openUrlVerbatim } from "./openExternal";

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

  it("opens VS Code's native integrated browser on the same URL string, its #token fragment intact", async () => {
    const url = "https://localhost:4123/#token=Ab9_-x%2Fy=z&env=staging";
    const executeCommand = vi.fn(async (_command: string, _url: string) => undefined);
    await integratedBrowser({ getCommands: async () => [], executeCommand }, () => undefined).open(url);
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(INTEGRATED_BROWSER_OPEN, url);
    expect(INTEGRATED_BROWSER_OPEN).toBe("workbench.action.browser.open");
  });

  it("detects the integrated browser once per session", async () => {
    const getCommands = vi.fn(async () => ["simpleBrowser.show", INTEGRATED_BROWSER_OPEN]);
    const browser = integratedBrowser({ getCommands, executeCommand: async () => undefined }, () => undefined);
    expect(await browser.available()).toBe(true);
    expect(await browser.available()).toBe(true);
    expect(getCommands).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("answers unavailable when VS Code has no integrated browser (only the Simple Browser)", async () => {
    const browser = integratedBrowser({ getCommands: async () => ["simpleBrowser.show"], executeCommand: async () => undefined }, () => undefined);
    expect(await browser.available()).toBe(false);
  });

  it("reports a detection that fails, and answers unavailable", async () => {
    const report = vi.fn();
    const failure = new Error("no commands");
    const browser = integratedBrowser({ getCommands: async () => { throw failure; }, executeCommand: async () => undefined }, report);
    expect(await browser.available()).toBe(false);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("does not keep a failed detection: the next launch asks VS Code again", async () => {
    const getCommands = vi.fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue([INTEGRATED_BROWSER_OPEN]);
    const browser = integratedBrowser({ getCommands, executeCommand: async () => undefined }, () => undefined);
    expect(await browser.available()).toBe(false);
    expect(await browser.available()).toBe(true);
    expect(await browser.available()).toBe(true);
    expect(getCommands).toHaveBeenCalledTimes(2);
  });
});
