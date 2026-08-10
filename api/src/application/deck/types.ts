/**
 * Deck generator types — the contract shared by the data layer, the binding
 * resolver, and the two renderers (generative pptxgenjs + in-place fflate fill).
 */

/** How a token's resolved value is injected into the deck. */
export type BindingKind = 'text' | 'table' | 'image';

/** Display formatting applied to a scalar text value. */
export type BindingFormat = 'number' | 'currency' | 'percent' | 'date' | 'quarter' | 'raw';

/** One {{token}} → data binding in a template's manifest. */
export interface TokenBinding {
  /** The literal token authored in the .pptx, WITHOUT braces, e.g. `quarter` or
   *  `table:deliverables`. The in-place filler matches `{{<token>}}`. */
  token: string;
  /** Dot-path into the assembled DeckData, e.g. `quality.uptimePct`. */
  bindingKey: string;
  kind: BindingKind;
  format?: BindingFormat;
  /** Fallback text when the binding resolves to null/undefined (default '—'). */
  fallback?: string;
}

export interface TokenManifest {
  version: number;
  bindings: TokenBinding[];
}

/** A resolved value ready for injection (text) or table expansion. */
export type ResolvedValue =
  | { kind: 'text'; value: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'image'; r2Key: string };

export interface ResolvedBindings {
  /** token (without braces) → resolved value. */
  byToken: Map<string, ResolvedValue>;
  /** Bindings that resolved to a fallback (missing data) — surfaced to the user. */
  warnings: string[];
}

/** The full data bundle the deck binds against. Shapes mirror the binding keys
 *  used in the built-in template manifests (migration 0241). Every leaf is
 *  nullable so a sparse tenant still renders (with fallbacks + warnings). */
export interface DeckData {
  meta: { quarter: string; tenantName: string | null; generatedAt: string };
  investment: {
    rdToRevenuePct: number | null;
    growthRdPct: number | null;
    totalActualUsd: number | null;
    totalPlanUsd: number | null;
    financialsByCategory: string[][];   // [category, actual, plan, vs-plan%]
    fteByCategory: string[][];          // [category, fte]
    initiatives: string[][];            // [initiative, objective]
  };
  deliverables: { rows: string[][] };   // [objective, initiative, %complete, target, cost]
  quality: {
    uptimePct: number | null;
    mttrHours: number | null;
    alertsCount: number | null;
    postProductionBugs: number | null;
    supportTickets: number | null;
    defectAging: string[][];            // [bucket, count]
  };
  delivery: {
    deploymentFrequencyPerDay: number | null;
    leadTimeHours: number | null;
    changeFailureRatePct: number | null;
    mttrHours: number | null;
    totalPrsMerged: number | null;
    totalIssuesResolved: number | null;
  };
  people: {
    attritionRatePct: number | null;
    devSatisfactionScore: number | null;
    waterfall: string[][];              // [month, hires, departures, net, end]
    openPositions: string[][];          // [title, priority, daysOpen, targetStart]
  };
  ai: {
    productivityScore: number | null;
    programInvestedUsd: number | null;
    adoption: string[][];               // [tool, adoptionPct, hoursSaved, costUsd]
    programs: string[][];               // [program, objective, investedUsd]
  };
  finance: {
    spendUsd: number | null;
    forecastUsd: number | null;
    costPerMergedPrUsd: number | null;
  };
}

export type DeckArchetype = 'board' | 'cfo_devfinops' | 'custom' | 'generative';
export type DeckMode = 'generative' | 'fill';

export interface DeckTemplateRecord {
  id: string;
  tenantId: number;
  name: string;
  description: string | null;
  archetype: DeckArchetype;
  r2Key: string | null;
  manifest: TokenManifest;
  isBuiltin: boolean;
}

export interface GenerateDeckInput {
  tenantId: number;
  userId: string | null;
  mode: DeckMode;
  templateId?: string;
  quarter?: string;
}

export interface GenerateDeckResult {
  deckId: string;
  bytes: Uint8Array;
  filename: string;
  warnings: string[];
}
