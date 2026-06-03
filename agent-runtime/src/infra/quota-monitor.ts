/**
 * QuotaMonitor — fetch token usage quota from Builderforce and warn when
 * the agentNode is approaching its budget limits.
 */

import { logDebug, logWarn } from "../logger.js";

export type QuotaStatus = {
  period: string;
  since: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  budgetTokens?: number;
  pctUsed?: number;
  nearLimit: boolean;
};

export type QuotaMonitorOptions = {
  baseUrl: string;
  agentNodeId: string;
  apiKey: string;
  /** Warn when usage exceeds this fraction of budget (default 0.8 = 80%) */
  warnThreshold?: number;
};

/**
 * Fetch current quota status from Builderforce.
 * Returns null if unavailable.
 */
export async function fetchQuotaStatus(opts: QuotaMonitorOptions): Promise<QuotaStatus | null> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/agentNodes/${opts.agentNodeId}/quota`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logDebug(`[quota-monitor] fetch failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      period: string;
      since: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      budgetTokens?: number;
    };
    const threshold = opts.warnThreshold ?? 0.8;
    const pctUsed =
      data.budgetTokens && data.budgetTokens > 0 ? data.totalTokens / data.budgetTokens : undefined;
    const nearLimit = pctUsed !== undefined ? pctUsed >= threshold : false;
    return { ...data, pctUsed, nearLimit };
  } catch (err) {
    logDebug(`[quota-monitor] fetch error: ${String(err)}`);
    return null;
  }
}

/**
 * Check quota and log a warning if near the limit.
 */
export async function checkAndWarnQuota(opts: QuotaMonitorOptions): Promise<void> {
  const quota = await fetchQuotaStatus(opts);
  if (!quota) {
    return;
  }
  if (quota.nearLimit) {
    const pct = quota.pctUsed != null ? ` (${Math.round(quota.pctUsed * 100)}% of budget)` : "";
    logWarn(
      `[quota-monitor] WARNING: token usage is approaching budget limit — ` +
        `${quota.totalTokens.toLocaleString()} tokens used in the last 30 days${pct}. ` +
        `Review usage in the Builderforce portal.`,
    );
  } else {
    logDebug(`[quota-monitor] ${quota.totalTokens.toLocaleString()} tokens used in last 30 days`);
  }
}
