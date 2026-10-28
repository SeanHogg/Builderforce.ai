import { describe, expect, it, vi } from "vitest";
import { summarizeRouteRuns } from "@seanhogg/builderforce-brain-embedded";

vi.mock("vscode", () => ({}));
vi.mock("./localFirstStore", () => ({ localBrainApplication: () => undefined }));

import { renderGateColumn, renderRouteReport, type Translate } from "./pipelineRouteReport";

const t: Translate = (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));

const gate = {
  runs: 5,
  answer: { runs: 2, judged: 2, accepted: 1 },
  prefetch: { runs: 1, judged: 1, accepted: 1 },
  llm: { runs: 2 },
  answeredBy: [{ actionId: "dup.check", runs: 2 }],
  savedCostMc: 300_000,
};

describe("the route report's PreFetch gate column", () => {
  it("renders the answer / prefetch / llm split with share and accuracy", () => {
    const md = renderGateColumn(gate, t).join("\n");
    expect(md).toContain("## PreFetch gate");
    expect(md).toContain("| Answered without a model | 2 | 40% | 50% (1 of 2) |");
    expect(md).toContain("| Facts gathered before the model | 1 | 20% | 100% (1 of 1) |");
    expect(md).toContain("| Sent to the model | 2 | 40% | — |");
    expect(md).toContain("Answered by: `dup.check` ×2. Estimated saving: $3.00.");
  });

  it("rides the report even when no run was routed, and says so when nothing was gated", () => {
    expect(renderRouteReport(summarizeRouteRuns([]), 30, t, gate)).toContain("## PreFetch gate");
    expect(renderGateColumn({ ...gate, runs: 0 }, t).join("\n")).toContain("No requests went through the PreFetch gate");
  });
});
