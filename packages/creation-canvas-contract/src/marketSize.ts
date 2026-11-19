/**
 * Market size — TAM / SAM / SOM, both ways (PRD 25 §5.5, §6.3).
 *
 * PURE and shared: the founder `marketSize` spec derives its fields through this, and the
 * deck engine's market slide reads the SAME function, so the canvas card and the slide can
 * never disagree about the number.
 *
 * Bottom-up is primary:  TAM = potential customers × ARPA,  SAM = serviceable × ARPA,
 * SOM = reachable × ARPA × achievable share.  Top-down triangulates:  a cited market figure
 * × a share assumption.  NOTHING here is stored — every figure is computed on read — and every
 * figure is `undefined` (never 0) when an input is missing.
 */

export const MARKET_SIZE_METHODS = ['bottom_up', 'top_down'] as const;
export type MarketSizeMethod = (typeof MARKET_SIZE_METHODS)[number];

/** Two methods within this fraction of each other is a health mark. */
export const TRIANGULATION_TOLERANCE = 0.15;

export interface MarketSizeInputs {
  potentialCustomers?: number;
  serviceableCustomers?: number;
  reachableCustomers?: number;
  arpa?: number;
  /** Fraction 0–1 (a value > 1 is read as a whole percentage, so 5 means 5%). */
  achievableShare?: number;
  topDownMarket?: number;
  /** Fraction 0–1 (a value > 1 is read as a whole percentage). */
  topDownShare?: number;
}

export interface MarketSizeFigures {
  tam?: number;
  sam?: number;
  som?: number;
  /** Top-down SOM: `topDownMarket × topDownShare`. */
  topDownSom?: number;
  /** |bottom-up SOM − top-down SOM| ÷ the larger of the two, as a fraction. */
  triangulationGap?: number;
}

export type MarketSizeVerdictKey =
  | 'consistent'
  | 'inconsistent'
  | 'triangulated'
  | 'divergent';

const finite = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** A share as a 0–1 fraction. `5` and `0.05` both mean 5%; `1` is 100%. */
export const asFraction = (value: unknown): number | undefined => {
  const n = finite(value);
  if (n === undefined || n < 0) return undefined;
  return n > 1 ? n / 100 : n;
};

const product = (...factors: Array<number | undefined>): number | undefined => {
  let out = 1;
  for (const factor of factors) {
    if (factor === undefined) return undefined;
    out *= factor;
  }
  return out;
};

/** Read the inputs off an object's `data`, tolerating prose-y numbers ("$1,200"). */
export function marketSizeInputsFrom(data: Record<string, unknown>): MarketSizeInputs {
  return {
    potentialCustomers: finite(data.potentialCustomers),
    serviceableCustomers: finite(data.serviceableCustomers),
    reachableCustomers: finite(data.reachableCustomers),
    arpa: finite(data.arpa),
    achievableShare: asFraction(data.achievableShare),
    topDownMarket: finite(data.topDownMarket),
    topDownShare: asFraction(data.topDownShare),
  };
}

export function computeMarketSize(input: MarketSizeInputs): MarketSizeFigures {
  const tam = product(input.potentialCustomers, input.arpa);
  const sam = product(input.serviceableCustomers, input.arpa);
  const som = product(input.reachableCustomers, input.arpa, input.achievableShare);
  const topDownSom = product(input.topDownMarket, input.topDownShare);
  let triangulationGap: number | undefined;
  if (som !== undefined && topDownSom !== undefined) {
    const larger = Math.max(Math.abs(som), Math.abs(topDownSom));
    triangulationGap = larger > 0 ? Math.abs(som - topDownSom) / larger : undefined;
  }
  return {
    ...(tam !== undefined ? { tam } : {}),
    ...(sam !== undefined ? { sam } : {}),
    ...(som !== undefined ? { som } : {}),
    ...(topDownSom !== undefined ? { topDownSom } : {}),
    ...(triangulationGap !== undefined ? { triangulationGap } : {}),
  };
}

/**
 * The verdicts the card draws. `inconsistent` when SOM ≤ SAM ≤ TAM is broken (only judged
 * across the figures that exist); `triangulated` is the health mark — the two methods agree
 * within 15%; `divergent` says they do not. Empty when there is nothing to judge.
 */
export function marketSizeVerdicts(figures: MarketSizeFigures): MarketSizeVerdictKey[] {
  const out: MarketSizeVerdictKey[] = [];
  const { tam, sam, som, triangulationGap } = figures;
  const chain = [som, sam, tam].filter((v): v is number => v !== undefined);
  if (chain.length >= 2) {
    const ordered = chain.every((value, i) => i === 0 || chain[i - 1]! <= value);
    out.push(ordered ? 'consistent' : 'inconsistent');
  }
  if (triangulationGap !== undefined) {
    out.push(triangulationGap <= TRIANGULATION_TOLERANCE ? 'triangulated' : 'divergent');
  }
  return out;
}

/** The slide-facing summary: figures plus whether they may be shown as sound. */
export interface MarketSizeSummary extends MarketSizeFigures {
  verdicts: MarketSizeVerdictKey[];
  inconsistent: boolean;
}

export function summarizeMarketSize(data: Record<string, unknown>): MarketSizeSummary {
  const figures = computeMarketSize(marketSizeInputsFrom(data));
  const verdicts = marketSizeVerdicts(figures);
  return { ...figures, verdicts, inconsistent: verdicts.includes('inconsistent') };
}
