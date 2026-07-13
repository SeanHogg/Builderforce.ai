import type { Command } from "commander";
import {
  formatUsageReportLines,
  loadProviderUsageSummary,
  type UsageSummary,
} from "../infra/provider-usage.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";

/**
 * The builder-insights snapshot the gateway streams. Mirrors
 * `BuilderInsightsSnapshot` in `api/src/application/insights/builderInsights.ts`.
 */
type BuilderInsightsSnapshot = {
  generatedAt: string;
  windowLabel: string;
  todayTokens: number;
  todayCostUsd: number;
  dailyCapTokens: number | null;
  pctOfDailyCap: number | null;
  topModel: { model: string; tokens: number } | null;
  costPerMergedPrUsd: number | null;
  tip: string | null;
};

type UsageCliOptions = { json?: boolean };

/** Resolve the gateway base URL + token, or null when not configured. */
function resolveGateway(): { url: string; token: string } | null {
  const url = process.env.BUILDERFORCE_GATEWAY_URL ?? process.env.BUILDERFORCE_URL;
  const token = process.env.BUILDERFORCE_API_KEY;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** Fetch the builder snapshot from the gateway. Returns null on any failure. */
async function fetchBuilderInsights(): Promise<BuilderInsightsSnapshot | null> {
  const gw = resolveGateway();
  if (!gw) return null;
  try {
    const res = await fetch(`${gw.url}/llm/v1/builder-insights`, {
      headers: { authorization: `Bearer ${gw.token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as BuilderInsightsSnapshot;
  } catch {
    return null;
  }
}

function formatBuilderInsightsLines(s: BuilderInsightsSnapshot): string[] {
  const lines: string[] = ["Workspace (gateway):"];
  lines.push(`  Tokens (${s.windowLabel}): ${s.todayTokens.toLocaleString()}`);
  lines.push(`  Cost: $${s.todayCostUsd.toFixed(2)}`);
  lines.push(
    `  % of daily cap: ${
      s.pctOfDailyCap == null
        ? "no cap"
        : `${s.pctOfDailyCap}%${s.dailyCapTokens ? ` of ${s.dailyCapTokens.toLocaleString()}` : ""}`
    }`,
  );
  if (s.topModel) lines.push(`  Top model: ${s.topModel.model} (${s.topModel.tokens.toLocaleString()} tok)`);
  if (s.costPerMergedPrUsd != null) lines.push(`  Cost / merged PR: $${s.costPerMergedPrUsd.toFixed(2)}`);
  if (s.tip) lines.push(`  Tip: ${s.tip}`);
  return lines;
}

export function registerUsageCli(program: Command) {
  program
    .command("usage")
    .description("Show provider usage / quota (and workspace spend when a gateway is configured)")
    .option("--json", "Emit raw JSON instead of a formatted report", false)
    .action(async (opts: UsageCliOptions) => {
      try {
        const summary: UsageSummary = await loadProviderUsageSummary();
        // Best-effort gateway snapshot — never throws, degrades to provider-only.
        const insights = await fetchBuilderInsights();

        if (opts.json) {
          defaultRuntime.log(JSON.stringify({ providers: summary, workspace: insights }, null, 2));
          return;
        }

        for (const line of formatUsageReportLines(summary)) {
          defaultRuntime.log(line);
        }
        if (insights) {
          defaultRuntime.log("");
          for (const line of formatBuilderInsightsLines(insights)) {
            defaultRuntime.log(line);
          }
        } else if (resolveGateway()) {
          defaultRuntime.log("");
          defaultRuntime.log(theme.muted("Workspace (gateway): unavailable."));
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
