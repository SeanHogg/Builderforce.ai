import { describe, expect, it, vi } from "vitest";
import { summarizeRouteRuns, type RouteRunRecord } from "@seanhogg/builderforce-brain-embedded";
import { MIN_QUICK_RUNS_FOR_SUGGESTION } from "@builderforce/pipeline-route";

vi.mock("vscode", () => ({}));
vi.mock("./localFirstStore", () => ({ localBrainApplication: () => undefined }));

import { renderRouteReport, type Translate } from "./pipelineRouteReport";

/** `vscode.l10n.t` without a bundle: the message with its `{n}` slots filled. */
const t: Translate = (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));

const at = (minutes: number): string => new Date(Date.UTC(2026, 9, 1, 12, minutes)).toISOString();
const run = (route: "full" | "quick", conversation: string, minutes: number, score: number, costMc: number): RouteRunRecord =>
  ({ route, score, costMc, conversation, startedAt: at(minutes) });

describe("renderRouteReport", () => {
  it("says so when nothing was routed", () => {
    expect(renderRouteReport(summarizeRouteRuns([]), 30, t)).toContain("No routed runs");
  });

  it("renders runs, cost and score per route, the histogram and the misroutes", () => {
    const report = summarizeRouteRuns(
      [run("quick", "a", 0, 0.21, 50_000), run("full", "a", 5, 0.81, 250_000), run("quick", "b", 0, 0.33, 25_000)],
      { threshold: 0.5 },
    );
    const md = renderRouteReport(report, 30, t);
    expect(md).toContain("Pipeline route report — last 30 days");
    expect(md).toContain("| Full pipeline | 1 | $2.50 | 0.81 |");
    expect(md).toContain("| Quick pass | 2 | $0.75 | 0.27 |");
    expect(md).toContain("| 0.2–0.3 | 0 | 1 |");
    expect(md).toContain("1 of 2 quick runs were re-run on the full pipeline");
    expect(md).toContain("Keep 0.50: 2 quick runs so far");
  });

  it("holds a suggestion to the report's own evidence floor, and words the shared number itself", () => {
    const few = summarizeRouteRuns([run("quick", "a", 0, 0.3, 0)], { threshold: 0.5 });
    expect(renderRouteReport(few, 30, t)).toContain(`${MIN_QUICK_RUNS_FOR_SUGGESTION} are needed before a change is suggested`);
    // Every quick run re-run on the full pipeline: the report says lower, the VSIX says it.
    const runs = Array.from({ length: MIN_QUICK_RUNS_FOR_SUGGESTION }, (_, i) => [
      run("quick", `c${i}`, 0, 0.32, 0),
      run("full", `c${i}`, 5, 0.8, 0),
    ]).flat();
    const report = summarizeRouteRuns(runs, { threshold: 0.5 });
    expect(report.suggestedThreshold).not.toBeNull();
    expect(report).not.toHaveProperty("suggestion");
    expect(renderRouteReport(report, 30, t)).toContain(`Lower it to ${report.suggestedThreshold!.toFixed(2)}`);
  });
});
