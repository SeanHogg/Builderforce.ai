import { describe, expect, it, vi } from "vitest";
import {
  DELETE_ACTION,
  DELETE_CONFIRM,
  STOP_EXECUTION_TO_DELETE,
  confirmDestructiveDelete,
  interpolate,
} from "./confirmDeletion";

function ui(picked: string | undefined) {
  const showWarningMessage = vi.fn(async (_message: string, _options: { modal: true }, ..._items: string[]) => picked);
  return { showWarningMessage };
}

describe("confirmDestructiveDelete", () => {
  it("deletes when the user confirms", async () => {
    const prompt = ui(DELETE_ACTION);
    await expect(
      confirmDestructiveDelete({ subject: "Ship it", executing: false, ui: prompt }),
    ).resolves.toBe(true);
    expect(prompt.showWarningMessage).toHaveBeenCalledTimes(1);
    const [message, options, action] = prompt.showWarningMessage.mock.calls[0]!;
    expect(message).toBe(interpolate(DELETE_CONFIRM, "Ship it"));
    expect(message).toContain("Ship it");
    expect(options).toEqual({ modal: true });
    expect(action).toBe(DELETE_ACTION);
  });

  it("does not delete when the user cancels", async () => {
    const prompt = ui(undefined);
    await expect(
      confirmDestructiveDelete({ subject: "Ship it", executing: false, ui: prompt }),
    ).resolves.toBe(false);
  });

  it("blocks an executing chat and tells the user to stop first", async () => {
    const prompt = ui(DELETE_ACTION);
    await expect(
      confirmDestructiveDelete({ subject: "Ship it", executing: true, ui: prompt }),
    ).resolves.toBe(false);
    expect(prompt.showWarningMessage).toHaveBeenCalledTimes(1);
    const [message, options, ...items] = prompt.showWarningMessage.mock.calls[0]!;
    expect(message).toBe(STOP_EXECUTION_TO_DELETE);
    expect(options).toEqual({ modal: true });
    // No Delete button — dismissing the modal is the only way out.
    expect(items).toEqual([]);
  });

  it("uses the supplied localizer for every string", async () => {
    const prompt = ui("Löschen");
    const t = (message: string, ...args: Array<string | number>) => {
      if (message === DELETE_ACTION) return "Löschen";
      if (message === DELETE_CONFIRM) return interpolate("„{0}“ löschen?", ...args);
      return interpolate(message, ...args);
    };
    await expect(
      confirmDestructiveDelete({ subject: "Ship it", executing: false, ui: prompt, t }),
    ).resolves.toBe(true);
    const [message, , action] = prompt.showWarningMessage.mock.calls[0]!;
    expect(message).toBe("„Ship it“ löschen?");
    expect(action).toBe("Löschen");
  });
});
