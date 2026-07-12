> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #254
> _Each agent that updates this PRD signs its change below._

# PRD: Overall Portfolio Health Summary

## Problem & Goal

Investment portfolio managers, financial advisors, and individual investors currently lack a single, at-a-glance view that communicates the overall health of their portfolio. Key metrics are scattered across multiple screens, reports, and data sources, forcing users to manually synthesize information before they can assess risk exposure, performance trends, and allocation balance. The goal is to deliver a **Portfolio Health Summary** — a unified, real-time dashboard surface that condenses the most critical portfolio signals into one coherent view, enabling faster and more confident investment decisions.

---

## Target Users / ICP Roles

| Role | Description |
|---|---|
| **Individual Retail Investor** | Manages personal brokerage or retirement accounts; wants a simple health score without deep financial expertise |
| **Wealth Manager / Financial Advisor** | Oversees multiple client portfolios; needs a quick triage view to identify which portfolios require attention |
| **Portfolio Analyst** | Runs quantitative review of allocations and risk; needs reliable aggregated metrics to anchor deeper analysis |
| **Institutional Fund Manager** | Monitors large, multi-asset portfolios; requires compliance-aware, audit-friendly summary data |

---

## Scope

### In Scope
- Single-view health summary for one portfolio at a time
- Aggregated performance metrics (daily, MTD, YTD, inception-to-date)
- Asset allocation breakdown and drift indicator vs. target allocation
- Risk metrics: volatility, beta, Sharpe ratio, Value-at-Risk (VaR)
- Diversification score and concentration warnings
- Portfolio health score (composite, rule-based)
- Gain/loss summary (realized and unrealized)
- Top movers (best and worst performing holdings)
- Data freshness timestamp and staleness warning
- Responsive layout (desktop and tablet)

---

## Functional Requirements

### FR-1: Portfolio Health Score
- The system must calculate and display a composite health score (0–100) derived from weighted sub-scores for performance, risk, diversification, and allocation drift.
- Score must update whenever underlying portfolio data refreshes.
- Each sub-score must be visible on expand/drill-down.

### FR-2: Performance Summary
- Display total portfolio value with absolute and percentage change for: 1D, 1W, MTD, YTD, and ITD periods.
- Benchmark comparison (e.g., S&P 500, custom benchmark) must be shown alongside portfolio return for each period.
- Sparkline trend chart must be rendered for the selected time period.

### FR-3: Asset Allocation & Drift
- Render current allocation by asset class (equities, fixed income, cash, alternatives, crypto, etc.) as both a donut chart and a data table.
- Display target allocation if configured; highlight drift > configurable threshold (default: ±5%) with a visual warning indicator.
- Allow the user to toggle between sector, geography, and asset-class views.

### FR-4: Risk Metrics Panel
- Display the following metrics with period-selectable windows (30D, 90D, 1Y): annualized volatility, portfolio beta, Sharpe ratio, Sortino ratio, and 95% 1-day VaR (dollar and percentage).
- Each metric must include a contextual tooltip defining the metric and its implication.
- Metrics exceeding configurable risk thresholds must be flagged with a warning state.

### FR-5: Diversification & Concentration Analysis
- Calculate and display a diversification score based on Herfindahl-Hirschman Index (HHI) of holdings weight.
- Flag any single holding that exceeds 10% of total portfolio value (configurable).
- Flag any single sector that exceeds 25% of total portfolio value (configurable).

### FR-6: Gain/Loss Summary
- Show total unrealized gain/loss (absolute and %) and total realized gain/loss for the current tax year.
- Break down by short-term vs. long-term capital gains.

### FR-7: Top Movers
- Display top 3 and bottom 3 holdings by percentage change for the selected period (default: 1D).
- Each mover entry must show: ticker/name, current price, change %, and holding weight.

### FR-8: Data Freshness
- Display a "Last updated" timestamp on the summary header.
- If data is older than 15 minutes during market hours, display a visible staleness warning banner.
- Provide a manual refresh trigger.

### FR-9: Multi-Portfolio Navigation (Advisor Role)
- Users with the Advisor or Fund Manager role must be able to switch between portfolios from a top-of-page selector without navigating away.
- A mini triage list showing health scores for all managed portfolios must be accessible via side panel.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Health score renders within 2 seconds of page load for a portfolio with up to 500 holdings using cached end-of-day data. |
| AC-2 | All six performance periods (1D, 1W, MTD, YTD, ITD, benchmark) display correct values verified against a known test portfolio fixture. |
| AC-3 | Allocation drift warnings appear automatically when any asset class deviates beyond the configured threshold; disappear when drift returns within bounds. |
| AC-4 | All four risk metrics (volatility, beta, Sharpe, VaR) match reference calculations within a tolerance of ±0.5% on the shared QA dataset. |
| AC-5 | Concentration flags trigger correctly for holdings ≥ 10% and sectors ≥ 25% on the test portfolio; no false positives on a diversified control portfolio. |
| AC-6 | Staleness warning banner appears within 1 minute of data exceeding the 15-minute threshold during simulated market-hours testing. |
| AC-7 | Advisor role users can switch between at least 50 managed portfolios without page reload; triage panel health scores match the full summary scores. |
| AC-8 | Page meets WCAG 2.1 AA accessibility standards as validated by automated audit tooling. |
| AC-9 | Layout renders without horizontal scroll on viewport widths ≥ 768px (tablet) and ≥ 1280px (desktop). |
| AC-10 | No personally identifiable financial data is exposed in client-side logs, network responses beyond authenticated sessions, or error messages. |

---

## Out of Scope

- **Trade execution or order management** — this is a read-only summary surface.
- **Mobile native app** (iOS/Android) — web responsive only in this iteration.
- **Real-time streaming tick data** — end-of-day and 15-minute delayed data only.
- **Tax optimization recommendations** — gain/loss display only; no actionable tax-loss harvesting suggestions.
- **Alternative asset manual entry** (art, real estate, collectibles) — structured financial instruments only.
- **Multi-currency portfolio consolidation** — single base-currency portfolios only.
- **AI-generated narrative commentary** on portfolio health — metric display only; no LLM-generated prose.
- **Historical health score trend** — current snapshot only; score history is a future iteration.
- **Third-party integrations / brokerage OAuth connections** — assumes portfolio data is already ingested by the platform data layer.