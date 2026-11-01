import { describe, expect, it } from "vitest";
import { ProgressDetector } from "./progressDetector.js";
import { NO_PROGRESS_TURNS } from "./noProgress.js";

const ports = { isReadOnly: (tool: string) => ["read_file", "search_code"].includes(tool) };
const platformPorts = { isPlatformProgress: (tool: string) => tool.startsWith("builtin_") && !tool.includes("_list_") };
const okData = { data: { ok: true } };

describe("debug read-only platform list trip", () => {
  it("logs the per-turn signal", () => {
    const d = new ProgressDetector({}, { ...ports, ...platformPorts });
    const kinds: Array<string | null> = [];
    for (let i = 0; i < NO_PROGRESS_TURNS + 2; i++) {
      d.observe("builtin_chats_list_tickets", { chatId: 187 }, okData);
      kinds.push(d.endTurn()?.signal.kind ?? null);
    }
    console.log("NO_PROGRESS_TURNS =", NO_PROGRESS_TURNS, "kinds =", JSON.stringify(kinds));
    expect(true).toBe(true);
  });
});
