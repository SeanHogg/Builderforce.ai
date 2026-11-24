import { describe, expect, it, vi } from "vitest";
import type { BrainChat } from "@seanhogg/builderforce-brain-embedded";
import { loadChatPersona, saveChatPersona, type ChatPersonaRecords } from "./chatPersona";

const chat = (extra: Partial<BrainChat> = {}): BrainChat => ({ id: 7, title: "t", projectId: null, createdAt: "", updatedAt: "", ...extra });

function records(row: BrainChat): ChatPersonaRecords & { updateChat: ReturnType<typeof vi.fn> } {
  return { getChat: async () => row, updateChat: vi.fn(async () => row) };
}

describe("chat persona state", () => {
  it("loads a record with no persona field as role off", async () => {
    expect(await loadChatPersona(records(chat()), 7)).toEqual({ role: null, lastRequest: null, hints: {} });
  });

  it("reads the stored state back, dropping a hint that is not an artifact", async () => {
    const stored = chat({ persona: { role: "designer", lastRequest: "r", hints: { engineer: ["mockup", "bogus"] } } });
    expect(await loadChatPersona(records(stored), 7)).toEqual({ role: "designer", lastRequest: "r", hints: { engineer: ["mockup"] } });
  });

  it("writes the state onto the same chat record", async () => {
    const r = records(chat());
    const state = { role: "analyst", lastRequest: "r", hints: {} };
    await saveChatPersona(r, 7, state);
    expect(r.updateChat).toHaveBeenCalledWith(7, { persona: state });
  });
});
