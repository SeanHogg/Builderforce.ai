/**
 * RFP / RFQ Response (PRD 15) — shared types.
 *
 * `RfpResponseBody` is the typed shape persisted in `rfp_responses.body` (JSONB): the
 * full generated proposal (capability roster, P&L, phase plan, risks, dependencies,
 * timeline, blended branding). Kept in one place so the route, the service, the doc
 * renderer and the frontend client agree on the contract.
 */

/** A co-branding palette — the asking business's OR the responder tenant's colours. */
export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  background: string;
  logoUrl?: string | null;
}

/** Itemised P&L for the build-out. All money in whole USD (rounded) for display;
 *  the queryable headline `quoted_price_usd_cents` is derived in cents on persist. */
export interface RfpCostLineItem {
  label: string;
  category: 'build' | 'agentic' | 'marketing' | 'contingency' | 'margin';
  amountUsd: number;
}

export interface RfpCostModel {
  buildCostUsd: number;
  agenticCostUsd: number;
  marketingCostUsd: number;
  contingencyUsd: number;
  subtotalCostUsd: number;
  marginPct: number;
  marginUsd: number;
  quotedPriceUsd: number;
  effortWeeks: number;
  lineItems: RfpCostLineItem[];
}

export interface RfpCapabilityRoster {
  capabilities: string[];
  keyComponents: { name: string; responsibility: string }[];
  frameworks: string[];
  primaryLanguages: string[];
  valueProps: string[];
  /** Where the roster facts came from: the deep architecture analysis, the fast
   *  deterministic audit signals, or (greenfield) derived from the requirements. */
  source: 'diagnostics' | 'audit' | 'greenfield';
}

export interface RfpPhase {
  name: string;
  startDate: string;
  endDate: string;
  milestones: { name: string; date: string }[];
}

export interface RfpRisk {
  title: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface RfpDependency {
  title: string;
  type: 'internal' | 'external' | 'third_party';
  note: string;
}

export interface RfpPortfolioMatch {
  projectId: number;
  name: string;
  score: number; // 0..1
  rationale: string;
}

export interface RfpScanFreshness {
  toolId: string;
  lastScanAt: string | null;
  ageDays: number | null;
  refreshed: boolean;
  /**
   * The DEEP architecture artifacts — the LLM `architecture-analysis` run —
   * which age INDEPENDENTLY of the deterministic audits above. Re-running the
   * audits refreshes the score and the file-tree signals; it does not rewrite
   * the capability roster, which comes from these artifacts. When they are
   * themselves stale the generator fires the architect run and reports
   * `refreshing`, so the roster shown is honestly labelled last-known.
   */
  deep?: RfpDeepFreshness;
}

export interface RfpDeepFreshness {
  lastArtifactAt: string | null;
  ageDays: number | null;
  /** `fresh` — the artifacts are current. `refreshing` — a run is in flight and
   *  the roster below it is the last-known one. `unavailable` — no run could be
   *  started (see `reason`), so the roster is last-known and will stay that way. */
  state: 'fresh' | 'refreshing' | 'unavailable';
  runId?: string | null;
  reason?: string | null;
}

/** One row of the risk / dependency REGISTER (migration 0483) — the same fact as
 *  the `risks` / `dependencies` arrays in the body, but queryable across
 *  responses and carrying its own lifecycle. */
export interface RfpRegisterEntry {
  id: string;
  responseId: string;
  requestId: string;
  kind: 'risk' | 'dependency';
  title: string;
  severity: 'low' | 'medium' | 'high' | null;
  dependencyType: 'internal' | 'external' | 'third_party' | null;
  detail: string | null;
  status: 'open' | 'accepted' | 'mitigated' | 'closed';
  ownerUserId: string | null;
  position: number;
  createdAt: string;
}

/** The cross-response roll-up the register exists to make possible. */
export interface RfpRegisterRollup {
  totalRisks: number;
  totalDependencies: number;
  openHighRisks: number;
  bySeverity: Record<'low' | 'medium' | 'high', number>;
  byStatus: Record<'open' | 'accepted' | 'mitigated' | 'closed', number>;
  byDependencyType: Record<'internal' | 'external' | 'third_party', number>;
  /** Titles raised on more than one response — what we ALWAYS carry. */
  recurring: { title: string; kind: 'risk' | 'dependency'; responses: number; worstSeverity: 'low' | 'medium' | 'high' | null }[];
}

export interface RfpResponseBody {
  executiveSummary: string;
  grounding: {
    mode: 'new' | 'existing';
    projectId?: number;
    projectName?: string;
    scanFreshness?: RfpScanFreshness;
  };
  capabilityRoster: RfpCapabilityRoster;
  costModel: RfpCostModel;
  plan: { phases: RfpPhase[] };
  risks: RfpRisk[];
  dependencies: RfpDependency[];
  timeline: { startDate: string; endDate: string; weeks: number };
  branding: { requester: BrandPalette; tenant: BrandPalette; blended: BrandPalette };
  portfolioMatches?: RfpPortfolioMatch[];
}

/** The narrative fields the model produces (the rest of the body is composed
 *  deterministically from real data). */
export interface RfpNarrative {
  executiveSummary: string;
  phases: RfpPhase[];
  risks: RfpRisk[];
  dependencies: RfpDependency[];
}
