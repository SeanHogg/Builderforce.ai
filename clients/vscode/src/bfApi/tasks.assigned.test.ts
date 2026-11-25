import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = vi.fn();
const reportExtensionError = vi.fn(async () => undefined);
vi.mock("./transport", () => ({ authed: (...a: unknown[]) => authed(...a) }));
vi.mock("../errorReporter", () => ({ reportExtensionError: (...a: unknown[]) => reportExtensionError(...(a as [])) }));

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
