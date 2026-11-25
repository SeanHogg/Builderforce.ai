import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = vi.fn();
const reportExtensionError = vi.fn(async () => undefined);
vi.mock("./transport", () => ({ authed: (...a: unknown[]) => authed(...a) }));
vi.mock("../diagnostics/errorReporter", () => ({ reportExtensionError: (...a: unknown[]) => reportExtensionError(...(a as [])) }));

import { listAssignedTasks } from "./tasks";

const secrets = {} as never;

beforeEach(() => {
  authed.mockReset();
  reportExtensionError.mockClear();
});

describe("listAssignedTasks", () => {
  it("regression: an unreadable list (outage / signed out) is undefined, never []", async () => {
    authed.mockResolvedValueOnce(undefined);
    await expect(listAssignedTasks(secrets)).resolves.toBeUndefined();
  });

  it("regression: a thrown read is reported and answers undefined, never []", async () => {
    const boom = new Error("network down");
    authed.mockRejectedValueOnce(boom);
    await expect(listAssignedTasks(secrets)).resolves.toBeUndefined();
    expect(reportExtensionError).toHaveBeenCalledWith(boom, { operation: "tasks:listAssigned" });
  });

  it.each([502, 503, 504])("a platform outage (HTTP %i) answers undefined WITHOUT filing an error report", async (status) => {
    authed.mockRejectedValueOnce(Object.assign(new Error(`/api/vscode/tasks → HTTP ${status}`), { status }));
    await expect(listAssignedTasks(secrets)).resolves.toBeUndefined();
    expect(reportExtensionError).not.toHaveBeenCalled();
  });

  it("a non-outage HTTP error (500) is still reported", async () => {
    authed.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    await expect(listAssignedTasks(secrets)).resolves.toBeUndefined();
    expect(reportExtensionError).toHaveBeenCalledTimes(1);
  });

  it("a genuinely empty assignment list is []", async () => {
    authed.mockResolvedValueOnce({ tasks: [] });
    await expect(listAssignedTasks(secrets)).resolves.toEqual([]);
    authed.mockResolvedValueOnce({});
    await expect(listAssignedTasks(secrets)).resolves.toEqual([]);
  });

  it("returns the assigned tasks when the read succeeds", async () => {
    const tasks = [{ id: 1, key: "T-1", title: "x" }];
    authed.mockResolvedValueOnce({ tasks });
    await expect(listAssignedTasks(secrets)).resolves.toEqual(tasks);
  });
});
