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
