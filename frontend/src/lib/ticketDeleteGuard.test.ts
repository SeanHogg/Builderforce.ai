import { describe, expect, it } from "vitest";
import { ACTIVE_EXECUTION_STATUSES } from "@/components/board/AgentChip";
import { ticketDeleteGate } from "./ticketDeleteGuard";

describe("ticketDeleteGate", () => {
  it("asks to confirm when nothing is executing", () => {
    expect(ticketDeleteGate([], ACTIVE_EXECUTION_STATUSES)).toBe("confirm");
    expect(ticketDeleteGate([{ status: "completed" }], ACTIVE_EXECUTION_STATUSES)).toBe("confirm");
    expect(ticketDeleteGate([{ status: "failed" }], ACTIVE_EXECUTION_STATUSES)).toBe("confirm");
    expect(ticketDeleteGate([{ status: "cancelled" }], ACTIVE_EXECUTION_STATUSES)).toBe("confirm");
  });

  it("blocks running, submitted, and pending executions", () => {
    expect(ticketDeleteGate([{ status: "running" }], ACTIVE_EXECUTION_STATUSES)).toBe("stop-execution");
    expect(ticketDeleteGate([{ status: "submitted" }], ACTIVE_EXECUTION_STATUSES)).toBe("stop-execution");
    expect(ticketDeleteGate([{ status: "pending" }], ACTIVE_EXECUTION_STATUSES)).toBe("stop-execution");
  });

  it("blocks when any of several runs is live", () => {
    expect(
      ticketDeleteGate([{ status: "completed" }, { status: "running" }], ACTIVE_EXECUTION_STATUSES),
    ).toBe("stop-execution");
  });
});
