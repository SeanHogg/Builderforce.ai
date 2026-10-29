import { describe, expect, it, vi } from "vitest";
import type { RunOutcomeRow } from "@builderforce/agent-run";
import { relayRunSinks } from "../../../run/relayRunSinks.js";
import { buildRunRowReport, clientRunIdFor } from "./outcome-reporter.js";

/**
 * The §8.2 uniform row the ONE agent writes, as the on-prem entry point reports it to
 * `/llm/v1/run-outcome`: keyed by the run's id, a sub-agent's row pointing at its owner's KEY.
 */
const row = (over: Partial<RunOutcomeRow> = {}): RunOutcomeRow => ({
  entryPoint: "on-prem",
  runId: "77",
  steps: 4,
  toolCalls: 6,
  toolErrors: 1,
  compactions: 0,
  stallRecoveries: 0,
  escalations: 0,
  verify: "not-run",
  terminalStatus: "finished",
  model: "kimi/k2",
  tokens: 1200,
  ...over,
});

describe("buildRunRowReport", () => {
  it("keys the report by the namespaced run id and carries the row's telemetry under the wire's names", () => {
    expect(buildRunRowReport(row())).toMatchObject({
      clientRunId: "onprem:77",
      source: "onprem",
      model: "kimi/k2",
      terminalStatus: "completed",
      steps: 4,
      entryPoint: "on-prem",
      toolCalls: 6,
      toolErrors: 1,
      tokens: 1200,
      verify: "not-run",
    });
  });

  it("namespaces the owner's id the SAME way, so a sub-agent's parent pointer joins its owner's key", () => {
    const owner = buildRunRowReport(row({ runId: "77" }));
    const child = buildRunRowReport(row({ runId: "c-1", parentRunId: "77" }));
    expect(child?.parentRunId).toBe(owner?.clientRunId);
    expect(child?.parentRunId).toBe(clientRunIdFor("77"));
    expect(owner?.parentRunId).toBeUndefined();
  });

  it("reports a failed run as failed, and nothing for a row it cannot key or attribute", () => {
    expect(buildRunRowReport(row({ terminalStatus: "failed" }))?.terminalStatus).toBe("failed");
    expect(buildRunRowReport(row({ runId: undefined }))).toBeNull();
    expect(buildRunRowReport(row({ model: undefined }))).toBeNull();
  });
});

describe("relayRunSinks — the outcome row teaches the fleet", () => {
  const deps = (reportOutcome: (r: RunOutcomeRow) => void) => ({ sendToRelay: vi.fn(), emitAudit: vi.fn(), persistAudit: vi.fn(), reportOutcome });

  it("reports the owner's row and each sub-agent's row", () => {
    const reported = vi.fn();
    const sinks = relayRunSinks(deps(reported));
    sinks.onOutcome?.(row());
    sinks.forChild?.("look").onOutcome?.(row({ runId: "c-1", parentRunId: "77" }));
    expect(reported.mock.calls.map(([r]) => (r as RunOutcomeRow).runId)).toEqual(["77", "c-1"]);
  });
});
