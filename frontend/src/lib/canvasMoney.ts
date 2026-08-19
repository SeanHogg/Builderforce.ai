/**
 * THE money value on the Creation Canvas — one parser, one type, one formatter.
 *
 * ── WHAT THIS EXISTS TO CLOSE ────────────────────────────────────────────────────
 * Every money field on a founder object was a human-readable STRING, by explicit
 * design: `founderObjects.ts` documented it as *"a human-readable amount including
 * its currency and any qualifier the source actually carried, e.g. `$1.2M ARR (2025
 * estimate)`"*. The reasoning was sound — a competitor's revenue is often a range, an
 * estimate, or "not disclosed", and an integer number of cents either loses the
 * qualifier or invents a precision the source never had.
 *
 * The reasoning was sound and the CONCLUSION was wrong, because it made a CFO's most
 * basic operation unrepresentable rather than merely unimplemented: `capTable.holders`
 * could not be totalled, `fundingRound.committed` could not be compared to
 * `targetAmount`, two entities could not be consolidated, and nothing could convert a
 * euro to a dollar. Every real figure left for a spreadsheet and came back as a
 * screenshot.
 *
 * ── THE RESOLUTION: KEEP THE QUALIFIER, ADD THE NUMBER ──────────────────────────
 * A {@link MoneyValue} carries BOTH — `amount` + `currency` for arithmetic, and
 * `qualifier` + `approximate` + `disclosed` for everything the string was protecting.
 * "~$2–4M ARR (2025 estimate)" parses to a real number (the midpoint), a real currency,
 * `approximate: true`, and the original text preserved verbatim in `text`. "not
 * disclosed" parses to `disclosed: false` and NO amount — which is the distinction that
 * matters, because an undisclosed figure must never silently total as zero.
 *
 * ── WHY IT PARSES RATHER THAN REQUIRING A MIGRATION ─────────────────────────────
 * Boards already exist with prose in these fields, and a model instructed for months to
 * write "$1.2M ARR" will keep doing it. {@link parseMoney} accepts a string, a number,
 * or an already-structured value, so every existing board becomes summable the moment
 * this ships and nothing has to be rewritten first. New authoring paths (`budget`,
 * `invoice`, `headcountPlan`) store the structured form directly; both read back
 * through the same function, which is what keeps this ONE primitive rather than two.
 *
 * ── THE RULE THAT MAKES A TOTAL TRUSTWORTHY ─────────────────────────────────────
 * {@link sumMoney} NEVER silently mixes currencies and NEVER silently drops an
 * unparseable entry. It returns the total alongside `skipped` and `currencies`, and the
 * callers render both — because a total that quietly omitted the two rows it could not
 * read is worse than no total at all. That is the same judgement `emptyShellProblem()`
 * makes on the authoring side and `truncated` makes on the query side.
 */

/**
 * ISO-4217 codes we accept, plus the symbols that map onto them.
 *
 * Deliberately a short list rather than the full 180: an unknown three-letter token in
 * a founder's prose ("$4M ARR" vs "4M ARR") is far more likely to be a word than a
 * currency, and guessing wrong silently relabels the money. Anything not here parses
 * with no currency, which callers render as "unit unknown" rather than assuming USD.
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', '₽': 'RUB', '₩': 'KRW',
  'A$': 'AUD', 'C$': 'CAD', 'NZ$': 'NZD', 'CHF': 'CHF', 'R$': 'BRL', '₪': 'ILS', 'kr': 'SEK',
};

export const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'INR', 'SEK', 'NOK',
  'DKK', 'SGD', 'HKD', 'ZAR', 'BRL', 'MXN', 'PLN', 'ILS', 'AED', 'KRW', 'RUB', 'TRY',
]);

/** Multipliers a founder actually writes. `bn` and `b` both appear in the wild. */
const SCALE_SUFFIXES: ReadonlyArray<[RegExp, number]> = [
  [/^(?:tn|t|trillion)\b/i, 1e12],
  [/^(?:bn|b|billion)\b/i, 1e9],
  [/^(?:mm|m|mn|million)\b/i, 1e6],
  [/^(?:k|thousand)\b/i, 1e3],
];

export interface MoneyValue {
  /**
   * The numeric amount in MAJOR units (dollars, not cents).
   *
   * Major units rather than integer cents because these figures are frequently in the
   * millions with two-decimal precision that was never real, and a cents integer implies
   * a precision the source did not carry — the exact objection the original string design
   * raised. `approximate` records that the precision is soft; the number stays readable.
   *
   * Absent when the source said something real but non-numeric ("not disclosed").
   */
  amount?: number;
  /** ISO-4217, uppercase. Absent when the source carried no currency at all. */
  currency?: string;
  /** True when the source was a range, a "~", an "approx", or an "estimate". */
  approximate?: boolean;
  /** False ONLY for an explicit refusal — "not disclosed", "undisclosed", "n/a". */
  disclosed?: boolean;
  /** The low/high ends when the source was a range. Kept so the spread survives. */
  low?: number;
  high?: number;
  /** Everything the source said that the number does not carry — "ARR", "2025 estimate". */
  qualifier?: string;
  /** The original text, verbatim. Rendered when there is nothing better to show. */
  text?: string;
  /** ISO instant this figure was true as of. Set by refreshers, never guessed. */
  asOf?: string;
}

const NOT_DISCLOSED = /\b(?:not\s+disclosed|undisclosed|not\s+public|unknown|n\/?a|tbd|confidential)\b/i;
const APPROXIMATE = /(?:~|≈|about|approx\.?|approximately|around|circa|est\.?|estimated?|roughly)/i;

/** Strip a leading currency symbol or trailing/leading ISO code, returning both halves. */
function extractCurrency(input: string): { currency?: string; rest: string } {
  let rest = input;
  let currency: string | undefined;

  // Multi-character symbols first, so "A$" is not read as a bare "$".
  for (const symbol of Object.keys(CURRENCY_SYMBOLS).sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(symbol);
    if (at >= 0) {
      currency = CURRENCY_SYMBOLS[symbol];
      rest = `${rest.slice(0, at)}${rest.slice(at + symbol.length)}`;
      break;
    }
  }

  // An ISO code anywhere in the text wins over a symbol, because "US$1.2M CAD" is
  // ambiguous prose and the explicit code is the stronger signal.
  const iso = rest.match(/\b([A-Z]{3})\b/);
  if (iso && KNOWN_CURRENCIES.has(iso[1])) {
    currency = iso[1];
    rest = `${rest.slice(0, iso.index)}${rest.slice((iso.index ?? 0) + 3)}`;
  }

  return { ...(currency ? { currency } : {}), rest };
}

/**
 * The first number in the text, with any scale suffix applied.
 *
 * `multiplier` is reported separately from `value` because the range rule below needs to
 * know whether a scale was WRITTEN or merely implied: in "$2–4M" only the second number
 * carries the suffix, and the first must inherit it.
 */
function readScaledNumber(input: string): { value: number; multiplier: number; consumed: number; at: number } | null {
  const match = input.match(/-?\d[\d,\s]*(?:\.\d+)?/);
  if (!match || match.index == null) return null;
  const digits = match[0].replace(/[,\s]/g, '');
  const base = Number(digits);
  if (!Number.isFinite(base)) return null;
  const after = input.slice(match.index + match[0].length).trimStart();
  const skipped = input.slice(match.index + match[0].length).length - after.length;
  for (const [pattern, multiplier] of SCALE_SUFFIXES) {
    const suffix = after.match(pattern);
    if (suffix) {
      return { value: base * multiplier, multiplier, consumed: match[0].length + skipped + suffix[0].length, at: match.index };
    }
  }
  return { value: base, multiplier: 1, consumed: match[0].length, at: match.index };
}

/**
 * Read a money value out of whatever is actually on the object.
 *
 * Accepts a `MoneyValue`, a number, or the prose the founder specs have been storing
 * since they shipped. Returns null only for genuinely empty input — an unparseable
 * non-empty string still returns a value carrying its `text`, because "we could not read
 * this" and "there is nothing here" are different facts and only the second one is safe
 * to omit from a report.
 */
export function parseMoney(input: unknown, fallbackCurrency?: string): MoneyValue | null {
  if (input == null) return null;

  if (typeof input === 'number') {
    return Number.isFinite(input)
      ? { amount: input, ...(fallbackCurrency ? { currency: fallbackCurrency.toUpperCase() } : {}) }
      : null;
  }

  if (typeof input === 'object' && !Array.isArray(input)) {
    const raw = input as Record<string, unknown>;
    // Already structured. Normalize rather than trust, so a model-authored object with
    // a string amount ("1200") still becomes arithmetic-safe.
    const amount = Number(raw.amount);
    const currency = typeof raw.currency === 'string' && KNOWN_CURRENCIES.has(raw.currency.toUpperCase())
      ? raw.currency.toUpperCase()
      : fallbackCurrency?.toUpperCase();
    const value: MoneyValue = {
      ...(Number.isFinite(amount) ? { amount } : {}),
      ...(currency ? { currency } : {}),
      ...(raw.approximate === true ? { approximate: true } : {}),
      ...(raw.disclosed === false ? { disclosed: false } : {}),
      ...(Number.isFinite(Number(raw.low)) ? { low: Number(raw.low) } : {}),
      ...(Number.isFinite(Number(raw.high)) ? { high: Number(raw.high) } : {}),
      ...(typeof raw.qualifier === 'string' && raw.qualifier.trim() ? { qualifier: raw.qualifier.trim().slice(0, 120) } : {}),
      ...(typeof raw.text === 'string' && raw.text.trim() ? { text: raw.text.trim().slice(0, 200) } : {}),
      ...(typeof raw.asOf === 'string' && raw.asOf.trim() ? { asOf: raw.asOf.trim() } : {}),
    };
    return value.amount == null && value.text == null && value.disclosed !== false ? null : value;
  }

  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  if (NOT_DISCLOSED.test(text)) return { disclosed: false, text: text.slice(0, 200) };

  const { currency, rest } = extractCurrency(text);
  const approximate = APPROXIMATE.test(text);
  const first = readScaledNumber(rest);
  if (!first) {
    // Non-empty and non-numeric: preserve it so a report can say what it could not read.
    return { text: text.slice(0, 200), ...(currency ? { currency } : {}) };
  }

  // A range — "$2–4M", "2 to 4 million", "$500k-1M".
  //
  // The rule that matters: a side with NO written scale inherits the other's. "$2–4M" is
  // two-to-four million, not two-to-four-million; "$500k–1M" already states both. Only a
  // bare side inherits, so "1000–2000" stays literal.
  const afterFirst = rest.slice(first.at + first.consumed);
  const rangeSeparator = afterFirst.match(/^\s*(?:-|–|—|to|through)\s*/i);
  let low: number | undefined;
  let high: number | undefined;
  let amount = first.value;
  if (rangeSeparator) {
    const second = readScaledNumber(afterFirst.slice(rangeSeparator[0].length));
    if (second) {
      const scale = Math.max(first.multiplier, second.multiplier);
      low = first.multiplier === 1 && second.multiplier > 1 ? first.value * scale : first.value;
      high = second.multiplier === 1 && first.multiplier > 1 ? second.value * scale : second.value;
      // A range that reads backwards ("4M–2M") is prose, not data: keep the ends in
      // order rather than producing a midpoint outside them.
      if (high < low) [low, high] = [high, low];
      amount = (low + high) / 2;
    }
  }

  const qualifier = rest
    .slice(0, first.at)
    .concat(' ', rangeSeparator || low != null ? '' : afterFirst)
    .replace(/[~≈]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.()-]+|[\s,;:.()-]+$/g, '')
    .trim();

  return {
    amount,
    ...(currency ? { currency } : fallbackCurrency ? { currency: fallbackCurrency.toUpperCase() } : {}),
    ...(approximate || low != null ? { approximate: true } : {}),
    ...(low != null ? { low } : {}),
    ...(high != null ? { high } : {}),
    ...(qualifier ? { qualifier: qualifier.slice(0, 120) } : {}),
    text: text.slice(0, 200),
  };
}

/** True when this value carries a number arithmetic may use. */
export function isSummable(value: MoneyValue | null): value is MoneyValue & { amount: number } {
  return !!value && typeof value.amount === 'number' && Number.isFinite(value.amount);
}

export interface MoneyTotal {
  /** Absent when nothing summable was found, or when currencies could not be reconciled. */
  total?: MoneyValue;
  /** How many inputs contributed to `total`. */
  counted: number;
  /**
   * Inputs deliberately NOT counted, with the reason. Rendered next to every total —
   * a total that silently omitted two rows is worse than no total.
   */
  skipped: Array<{ text: string; reason: 'unparseable' | 'undisclosed' | 'currency' }>;
  /** Every distinct currency seen, so a mixed set can say so rather than guess. */
  currencies: string[];
  /** True when at least one input was a range or an estimate. */
  approximate: boolean;
}

export interface FxRates {
  /** The currency every rate is quoted against. */
  base: string;
  /** `rates[code]` = how many `code` one `base` buys. */
  rates: Readonly<Record<string, number>>;
  asOf?: string;
}

/** Convert, or null when the pair is not covered by the supplied rates. */
export function convertMoney(value: MoneyValue, to: string, fx?: FxRates | null): MoneyValue | null {
  if (!isSummable(value)) return null;
  const target = to.toUpperCase();
  const from = value.currency?.toUpperCase();
  if (!from || from === target) return { ...value, currency: target };
  if (!fx) return null;
  const base = fx.base.toUpperCase();
  const rateFrom = from === base ? 1 : fx.rates[from];
  const rateTo = target === base ? 1 : fx.rates[target];
  if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo) || !rateFrom) return null;
  const amount = (value.amount / rateFrom) * rateTo;
  return {
    ...value,
    amount,
    currency: target,
    approximate: true,
    ...(fx.asOf ? { asOf: fx.asOf } : {}),
    qualifier: [value.qualifier, `converted from ${from}`].filter(Boolean).join(' · ').slice(0, 120),
  };
}

/**
 * Total a set of money values.
 *
 * `currency` forces the output currency; without it the total adopts the majority
 * currency and anything else is skipped with reason `currency` rather than added as if
 * a euro were a dollar. Supplying `fx` converts instead of skipping.
 */
export function sumMoney(
  inputs: readonly unknown[],
  options: { currency?: string; fx?: FxRates | null } = {},
): MoneyTotal {
  const parsed = inputs.map((input) => ({ input, value: parseMoney(input) }));
  const skipped: MoneyTotal['skipped'] = [];
  const currencies = new Set<string>();
  let approximate = false;

  for (const { value } of parsed) {
    if (value?.currency) currencies.add(value.currency);
    if (value?.approximate) approximate = true;
  }

  // The output currency: explicit, else the most common one seen, else none (which
  // means every value was a bare number and adding them is unambiguous).
  const counts = new Map<string, number>();
  for (const { value } of parsed) {
    if (isSummable(value) && value.currency) counts.set(value.currency, (counts.get(value.currency) ?? 0) + 1);
  }
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const target = options.currency?.toUpperCase() ?? majority;

  let total = 0;
  let counted = 0;
  for (const { input, value } of parsed) {
    const label = typeof input === 'string' ? input : value?.text ?? String(input ?? '');
    if (!value) continue;
    if (value.disclosed === false) { skipped.push({ text: label, reason: 'undisclosed' }); continue; }
    if (!isSummable(value)) { skipped.push({ text: label, reason: 'unparseable' }); continue; }
    if (target && value.currency && value.currency !== target) {
      const converted = convertMoney(value, target, options.fx);
      if (!converted || !isSummable(converted)) { skipped.push({ text: label, reason: 'currency' }); continue; }
      total += converted.amount;
      counted += 1;
      approximate = true;
      continue;
    }
    total += value.amount;
    counted += 1;
  }

  return {
    ...(counted > 0 ? { total: { amount: total, ...(target ? { currency: target } : {}), ...(approximate ? { approximate: true } : {}) } } : {}),
    counted,
    skipped,
    currencies: [...currencies].sort(),
    approximate,
  };
}

/**
 * Render a money value for a human.
 *
 * `compact` is the canvas default: a card has room for "$1.2M" and not for
 * "$1,200,000.00", and the full figure is available in the inspector.
 */
export function formatMoney(
  value: MoneyValue | null | undefined,
  options: { locale?: string; compact?: boolean; withQualifier?: boolean } = {},
): string {
  if (!value) return '';
  const { locale = 'en', compact = true, withQualifier = false } = options;
  if (value.disclosed === false) return value.text ?? 'not disclosed';
  if (!isSummable(value)) return value.text ?? '';

  const formatted = (() => {
    try {
      return new Intl.NumberFormat(locale, {
        ...(value.currency ? { style: 'currency' as const, currency: value.currency } : {}),
        ...(compact && Math.abs(value.amount) >= 10_000
          ? { notation: 'compact' as const, maximumFractionDigits: 1 }
          : { maximumFractionDigits: Number.isInteger(value.amount) ? 0 : 2 }),
      }).format(value.amount);
    } catch {
      // An unknown code must not blank the card.
      return `${value.amount.toLocaleString(locale)}${value.currency ? ` ${value.currency}` : ''}`;
    }
  })();

  const prefix = value.approximate ? '~' : '';
  const suffix = withQualifier && value.qualifier ? ` ${value.qualifier}` : '';
  return `${prefix}${formatted}${suffix}`;
}

/**
 * INTEGER CENTS → a display string. The other money shape this codebase holds.
 *
 * ── WHY A SECOND FORMATTER, AND WHY IT IS *THIS* ONE ─────────────────────────────
 * `MoneyValue` above models a figure a model RESEARCHED — major units, possibly a range,
 * possibly "not disclosed", possibly carrying a qualifier. That is the right shape for a
 * competitor's revenue and the wrong shape for money the platform itself owns: a price, a
 * commission, a payout, a quote total. Those are exact integer cents from our own
 * database, and running them through `parseMoney` would take a number that is precisely
 * right and re-derive it through a string parser built for approximation.
 *
 * So both shapes exist on purpose — and until now the CENTS shape had no home, which is
 * exactly what the DRY rule predicts: twenty-plus surfaces each wrote their own
 * `new Intl.NumberFormat(locale, {style:'currency'}).format(cents / 100)` or, worse,
 * `` `${cur} ${(cents/100).toFixed(2)}` ``. They had already drifted — some show cents,
 * some round to whole units, some prefix a bare currency CODE where every other surface
 * renders a symbol — so the same $1,250.00 read three different ways depending on which
 * page you were on. This is the one implementation they all now call.
 *
 * `null`/non-finite renders as an em dash rather than "$0.00": a price nobody has set and
 * a price of zero are different facts, and rendering the first as the second is how a
 * free listing and an unpriced one become indistinguishable.
 */
export function formatCents(
  cents: number | null | undefined,
  options: { currency?: string; locale?: string; maximumFractionDigits?: number } = {},
): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const { currency = 'USD', locale, maximumFractionDigits } = options;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      ...(maximumFractionDigits == null ? {} : { maximumFractionDigits }),
    }).format(cents / 100);
  } catch {
    // An unknown or malformed ISO code must not blank the figure — the same refusal
    // `formatMoney` above already makes for the researched shape.
    return `${(cents / 100).toLocaleString(locale, { maximumFractionDigits: maximumFractionDigits ?? 2 })} ${currency}`;
  }
}

/** Format straight from whatever is stored, which is what card bodies actually hold. */
export function formatMoneyField(input: unknown, options?: Parameters<typeof formatMoney>[1]): string {
  return formatMoney(parseMoney(input), options);
}

/**
 * Sum ONE column across a set of row objects — the shape every founder `rows` field has.
 *
 * This is the operation the string design made impossible and the one a CFO performs
 * first: total `capTable.holders[].shares`, `fundingRound.useOfFunds[].amount`,
 * `budget.lines[].planned`, `invoice.lineItems[].amount`.
 */
export function sumRowColumn(
  rows: unknown,
  column: string,
  options?: { currency?: string; fx?: FxRates | null },
): MoneyTotal {
  if (!Array.isArray(rows)) return { counted: 0, skipped: [], currencies: [], approximate: false };
  return sumMoney(
    rows.map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : undefined)),
    options ?? {},
  );
}

/**
 * Does a set of percentages actually total 100?
 *
 * `capTable` documents the requirement in prose — *"Percentages must total ~100
 * including the pool — if they do not, say so in `summary` rather than adjusting a
 * number to make it balance"* — and nothing checked it, so the instruction was advice to
 * a model rather than a property of the object. This makes it checkable.
 */
export function percentBalance(rows: unknown, column: string, tolerance = 0.5): {
  total: number;
  balanced: boolean;
  counted: number;
} {
  const values = Array.isArray(rows)
    ? rows.flatMap((row) => {
      const cell = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : undefined;
      const numeric = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(numeric) && String(cell ?? '').trim() ? [numeric] : [];
    })
    : [];
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total: Number(total.toFixed(2)), balanced: values.length > 0 && Math.abs(total - 100) <= tolerance, counted: values.length };
}
