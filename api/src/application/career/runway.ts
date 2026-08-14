/**
 * Personal runway — how long the money lasts, and what each option does to that.
 *
 * ── THE NUMBER THE PRODUCT DID NOT HAVE ──────────────────────────────────────────
 * Every money object on the canvas belonged to a company: pricing, cap table, funding
 * round, investor update, data room. `liveMetric` binds domain series like
 * `finance.runway_months` for a TENANT. Nothing modelled savings ÷ burn for a person.
 *
 * That absence is not cosmetic. It is the number that governs every other decision
 * someone out of work makes: whether to take contract work today at 60% of their old
 * rate, or hold out for the salaried role that pays more and lands in eleven weeks. The
 * career tooling can score a résumé and rank a target beautifully, and without this it
 * cannot answer the only question actually being asked.
 *
 * ── WHY IT SITS BESIDE THE LISTING RATHER THAN IN A FINANCE MODULE ───────────────
 * Because the answer is a comparison between the two things the listing offers. A
 * `services` engagement pays sooner and less; an `employment` offer pays more and later.
 * The runway is what converts those into the same unit, which is why {@link compareOptions}
 * takes both shapes and reports weeks rather than currency.
 *
 * ── PURITY AND THE CLOCK ─────────────────────────────────────────────────────────
 * `asOf` is a parameter, never `Date.now()`. Every function here is deterministic for a
 * given input, so the same board recomputed tomorrow moves because the DATE moved and
 * not because the function is non-deterministic — and the tests do not need a fake clock.
 */

/** One recurring or one-off amount, in whole currency units per month. */
export interface RunwayInput {
  /** Cash available now — savings, notice pay, anything already banked. */
  savings: number;
  /** Everything that leaves the account in a normal month. */
  monthlyExpenses: number;
  /** Money still coming in monthly — benefits, a partner's contribution, residual income. */
  monthlyIncome?: number;
  currency?: string;
  /** One-off amounts landing on a known date, e.g. a final invoice or a tax refund. */
  expectedInflows?: Array<{ label: string; amount: number; inMonths: number }>;
  /** Known one-off costs, e.g. an insurance renewal. */
  expectedOutflows?: Array<{ label: string; amount: number; inMonths: number }>;
}

export interface RunwayReading {
  currency: string;
  netMonthlyBurn: number;
  /** Whole weeks until the balance reaches zero. `null` when income covers expenses. */
  weeksRemaining: number | null;
  monthsRemaining: number | null;
  /** Month-by-month balance, so the cliff is visible rather than implied. */
  projection: Array<{ month: number; balance: number; note: string | null }>;
  /** The urgency band the rest of the career plan should be paced against. */
  pressure: 'none' | 'comfortable' | 'planning' | 'urgent' | 'critical';
  assumptions: string[];
  instruction: string;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Project the balance forward and report when it runs out. */
export function computeRunway(input: RunwayInput, horizonMonths = 24): RunwayReading {
  const currency = (input.currency ?? 'USD').toUpperCase();
  const income = Math.max(0, input.monthlyIncome ?? 0);
  const expenses = Math.max(0, input.monthlyExpenses || 0);
  const netMonthlyBurn = round(expenses - income);

  const inflows = input.expectedInflows ?? [];
  const outflows = input.expectedOutflows ?? [];
  const projection: RunwayReading['projection'] = [];
  let balance = Math.max(0, input.savings || 0);
  let zeroMonth: number | null = null;

  for (let month = 1; month <= Math.max(1, Math.min(120, horizonMonths)); month += 1) {
    const notes: string[] = [];
    for (const flow of inflows) {
      if (flow.inMonths === month) { balance += Math.max(0, flow.amount); notes.push(`+${flow.label}`); }
    }
    for (const flow of outflows) {
      if (flow.inMonths === month) { balance -= Math.max(0, flow.amount); notes.push(`−${flow.label}`); }
    }
    balance = round(balance - netMonthlyBurn);
    projection.push({ month, balance, note: notes.length ? notes.join(', ') : null });
    if (balance <= 0 && zeroMonth === null) { zeroMonth = month; break; }
  }

  const monthsRemaining = zeroMonth;
  const weeksRemaining = zeroMonth === null ? null : Math.max(0, Math.floor(zeroMonth * 4.33));
  const pressure: RunwayReading['pressure'] = netMonthlyBurn <= 0 ? 'none'
    : weeksRemaining === null ? 'comfortable'
      : weeksRemaining <= 6 ? 'critical'
        : weeksRemaining <= 13 ? 'urgent'
          : weeksRemaining <= 26 ? 'planning' : 'comfortable';

  return {
    currency,
    netMonthlyBurn,
    weeksRemaining,
    monthsRemaining,
    projection,
    pressure,
    assumptions: [
      `Expenses ${currency} ${expenses.toLocaleString('en-US')}/month against income ${currency} ${income.toLocaleString('en-US')}/month.`,
      netMonthlyBurn <= 0
        ? 'Income currently covers expenses, so the savings balance is not being drawn down.'
        : `Net burn ${currency} ${netMonthlyBurn.toLocaleString('en-US')}/month, applied evenly.`,
      'No tax on the inflows, no inflation on the expenses, and no change in spending as the balance falls.',
      inflows.length || outflows.length
        ? `${inflows.length} expected inflow(s) and ${outflows.length} expected outflow(s) applied on their stated months.`
        : 'No one-off inflows or outflows were supplied.',
    ],
    instruction: netMonthlyBurn <= 0
      ? 'Income covers expenses, so there is no cliff. Say so plainly and shift the conversation to what they WANT rather than what they can afford — this is the position from which someone should be selective.'
      : 'Lead with the weeks, not the currency: "about N weeks" is the number that sets the pace of everything else. Then say what the pressure band means for strategy — under 13 weeks, taking contract work while interviewing usually beats holding out, and that is exactly what the comparison tool is for.',
  };
}

// ---------------------------------------------------------------------------
// Deciding between the two kinds of work
// ---------------------------------------------------------------------------

export interface WorkOption {
  label: string;
  /** Which side of the listing this option comes from. */
  kind: 'services' | 'employment';
  /** Gross monthly amount this option pays once it starts. */
  monthlyAmount: number;
  /** Months until the first payment actually lands, including notice and payment terms. */
  startsInMonths: number;
  /** For contract work: how many months it is expected to last. Employment is open-ended. */
  durationMonths?: number;
  /** Time it consumes that would otherwise go into the search, 0..1. */
  searchTimeCost?: number;
  notes?: string;
}

export interface OptionComparison {
  baseline: { weeksRemaining: number | null; pressure: RunwayReading['pressure'] };
  options: Array<{
    label: string;
    kind: 'services' | 'employment';
    /** Runway with this option taken, in weeks. `null` means it removes the cliff. */
    weeksRemaining: number | null;
    /** Weeks bought relative to doing nothing. */
    weeksGained: number | null;
    /** What it costs the search, stated rather than buried. */
    searchImpact: string;
    firstMoneyInMonths: number;
  }>;
  instruction: string;
}

/**
 * Compare "take the contract" against "hold for the salaried role" in weeks of runway.
 *
 * The comparison people get wrong is not the rate — it is the START DATE. A salaried
 * offer at twice the money that begins in three months is worth less than a two-month
 * contract at half the money when the balance hits zero in seven weeks, and the arithmetic
 * that shows it is exactly this.
 *
 * `searchTimeCost` is carried explicitly because the real cost of contract work is not
 * financial: it is the applications not sent while doing it, and a comparison that hides
 * that is the one that traps someone in six-week contracts for a year.
 */
export function compareOptions(runway: RunwayInput, options: readonly WorkOption[]): OptionComparison {
  const baseline = computeRunway(runway);

  const rows = options.map((option) => {
    const start = Math.max(0, option.startsInMonths || 0);
    const duration = option.kind === 'employment' ? 120 : Math.max(1, option.durationMonths ?? 3);
    const inflows = [...(runway.expectedInflows ?? [])];
    // Model the option as monthly inflows landing from its start month for its duration.
    for (let m = start + 1; m <= start + duration && m <= 120; m += 1) {
      inflows.push({ label: option.label, amount: Math.max(0, option.monthlyAmount), inMonths: m });
    }
    const withOption = computeRunway({ ...runway, expectedInflows: inflows });
    const gained = withOption.weeksRemaining === null || baseline.weeksRemaining === null
      ? null
      : withOption.weeksRemaining - baseline.weeksRemaining;

    const cost = option.searchTimeCost ?? (option.kind === 'services' ? 0.5 : 1);
    return {
      label: option.label,
      kind: option.kind,
      weeksRemaining: withOption.weeksRemaining,
      weeksGained: gained,
      searchImpact: cost >= 0.95
        ? 'Ends the search — this is the destination, not a bridge to it.'
        : cost <= 0.1
          ? 'Barely touches the search; applications continue at full rate.'
          : `Consumes roughly ${Math.round(cost * 100)}% of the time that would otherwise go into applications. At that rate the search takes about ${Math.round(1 / Math.max(0.05, 1 - cost))}× longer.`,
      firstMoneyInMonths: start,
    };
  });

  return {
    baseline: { weeksRemaining: baseline.weeksRemaining, pressure: baseline.pressure },
    options: rows,
    instruction: 'Compare on WEEKS BOUGHT and WHEN THE FIRST PAYMENT LANDS, not on the headline rate — a larger number arriving after the balance hits zero is worth nothing. Then state the search cost plainly: contract work that consumes most of the week is a bridge that can quietly become the destination. Give a recommendation, and name the one fact that would change it.',
  };
}
