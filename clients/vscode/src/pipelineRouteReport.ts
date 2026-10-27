/**
 * `BuilderForce: Pipeline Route Report` — what the pipeline router did on THIS machine
 * over the last {@link REPORT_DAYS} days, read from the run usage ledger: runs, cost and
 * mean score per route, the score histogram, the misroute proxy (quick runs re-run on
 * the full pipeline, or failed) and the threshold the evidence suggests. Opened as a
 * Markdown preview; nothing leaves the machine. How each run ended is its `run-outcome`
 * record, written at run end beside its usage rows.
 *
 * The fold and the arithmetic are shared (`routeRunRecords`, `summarizeRouteRuns`);
 * this module only renders — every line localized here from the report's NUMBERS (the
 * shared report carries no English of its own) — and {@link renderRouteReport} is pure
 * so it is tested without an editor.
 */

import * as vscode from "vscode";
import {
  DEFAULT_ROUTE_THRESHOLD,
  routeRunRecords,
  runOutcomesSince,
  summarizeRouteRuns,
  usageRowsSince,
  type RouteReport,
} from "@seanhogg/builderforce-brain-embedded";
import { MIN_QUICK_RUNS_FOR_SUGGESTION } from "@builderforce/pipeline-route";
import { MILLICENTS_PER_USD } from "@builderforce/spend-contract";
import { localBrainApplication } from "./localFirstStore";

export const PIPELINE_ROUTE_REPORT_COMMAND = "builderforce.pipelineRouteReport";
/** The window the report reads. */
export const REPORT_DAYS = 30;

/** `vscode.l10n.t`'s shape, injected so the renderer stays pure. */
export type Translate = (message: string, ...args: Array<string | number>) => string;

const usd = (millicents: number): string => `$${(millicents / MILLICENTS_PER_USD).toFixed(2)}`;
const score = (n: number | null): string => (n == null ? "—" : n.toFixed(2));

/** The report as Markdown. */
export function renderRouteReport(report: RouteReport, days: number, t: Translate): string {
  const lines: string[] = [`# ${t("Pipeline route report — last {0} days", days)}`, ""];
  if (report.runs === 0) {
    lines.push(t("No routed runs in this window. Runs are routed when builderforce.pipeline.routing is auto or always."));
    return `${lines.join("\n")}\n`;
  }
  lines.push(t("{0} routed runs. Threshold: {1} (builderforce.pipeline.routeThreshold).", report.runs, report.threshold.toFixed(2)), "");
  lines.push(
    `| ${t("Route")} | ${t("Runs")} | ${t("Cost")} | ${t("Avg score")} |`,
    "| --- | ---: | ---: | ---: |",
    `| ${t("Full pipeline")} | ${report.byRoute.full.runs} | ${usd(report.byRoute.full.costMc)} | ${score(report.byRoute.full.avgScore)} |`,
    `| ${t("Quick pass")} | ${report.byRoute.quick.runs} | ${usd(report.byRoute.quick.costMc)} | ${score(report.byRoute.quick.avgScore)} |`,
    "",
    `## ${t("Score histogram")}`,
    "",
    `| ${t("Score")} | ${t("Full pipeline")} | ${t("Quick pass")} |`,
    "| --- | ---: | ---: |",
    ...report.histogram.map((bin) => `| ${bin.from.toFixed(1)}–${bin.to.toFixed(1)} | ${bin.full} | ${bin.quick} |`),
    "",
    `## ${t("Misroutes")}`,
    "",
  );
  lines.push(
    report.misrouteRate == null
      ? t("No quick runs in this window.")
      : t(
        "{0} of {1} quick runs were re-run on the full pipeline within 30 minutes, or failed ({2}%).",
        report.misroutes,
        report.byRoute.quick.runs,
        Math.round(report.misrouteRate * 100),
      ),
    "",
    `## ${t("Suggested threshold")}`,
    "",
    suggestionLine(report, t),
  );
  return `${lines.join("\n")}\n`;
}

function suggestionLine(report: RouteReport, t: Translate): string {
  const current = report.threshold.toFixed(2);
  // The report's own evidence floor (`@builderforce/pipeline-route`) — one number, not a copy.
  if (report.byRoute.quick.runs < MIN_QUICK_RUNS_FOR_SUGGESTION) {
    return t("Keep {0}: {1} quick runs so far, {2} are needed before a change is suggested.", current, report.byRoute.quick.runs, MIN_QUICK_RUNS_FOR_SUGGESTION);
  }
  const next = report.suggestedThreshold;
  if (next == null || next === report.threshold) return t("Keep {0}: the misroute rate is within the expected band.", current);
  return next < report.threshold
    ? t("Lower it to {0}: too many quick runs needed the full pipeline.", next.toFixed(2))
    : t("Raise it to {0}: quick runs rarely needed the full pipeline, so quick can take more.", next.toFixed(2));
}

/** Read the ledger, render the report and open it as a Markdown preview. */
async function showRouteReport(ctx: vscode.ExtensionContext): Promise<void> {
  const local = localBrainApplication(ctx);
  const since = new Date(Date.now() - REPORT_DAYS * 86_400_000);
  const [rows, outcomes] = await Promise.all([
    usageRowsSince(local.store, local.deviceId, since),
    runOutcomesSince(local.store, local.deviceId, since),
  ]);
  const threshold = vscode.workspace.getConfiguration("builderforce").get<number>("pipeline.routeThreshold") ?? DEFAULT_ROUTE_THRESHOLD;
  // A quick run recorded as failed counts as misrouted, as does one re-run on the full pipeline.
  const report = summarizeRouteRuns(routeRunRecords(rows, undefined, outcomes), { threshold });
  const doc = await vscode.workspace.openTextDocument({ content: renderRouteReport(report, REPORT_DAYS, vscode.l10n.t), language: "markdown" });
  await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
}

export function registerPipelineRouteReport(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(PIPELINE_ROUTE_REPORT_COMMAND, () =>
      showRouteReport(ctx).catch((e: unknown) => {
        void vscode.window.showErrorMessage(vscode.l10n.t("The pipeline route report could not be built: {0}", e instanceof Error ? e.message : String(e)));
      }),
    ),
  );
}
