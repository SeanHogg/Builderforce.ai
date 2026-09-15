/**
 * The founder's free finance calculators (PRD 19 B1) — BurnRateOS's `/tools/runway`,
 * `/tools/burn-rate`, `/tools/churn`, `/tools/break-even` and `/pricing-simulator`,
 * as five rows of the ONE tools registry.
 *
 * BurnRateOS shipped each as its own marketing page with its own arithmetic.
 * Here they are `CalculatorTool` definitions like the DORA quick-check: public,
 * free, computed on the server so a saved run is authoritative, and localized
 * through the same catalog as every other tool. The runway arithmetic is the
 * contract package's `computeRunway` — the same function the CFO seat, the
 * founder's onboarding step and the marketing calculator run — so the free tool
 * cannot advise a different runway than the product prints for the same inputs.
 *
 * Result prose is composed from each tool's `copy` map (the DORA pattern), so the
 * completeness test derives its key set from it and a sentence ships translated
 * or the build goes red.
 */

import { computeRunway } from '@builderforce/creation-canvas-contract';
import type { CalculatorTool, ToolResult } from './toolTypes';
import { money, monthsLabel, percent } from './toolFormat';

const clamp = (n: number | undefined, min: number, max = Number.POSITIVE_INFINITY): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? (n as number) : min));

// ─────────────────────────────────────────────────────────────────────────────
// Runway
// ─────────────────────────────────────────────────────────────────────────────

const RUNWAY_COPY = {
  'headline.months': '{months} months of runway',
  'headline.profitable': 'Not burning — runway is not the constraint',
  summary: 'Cash divided by NET burn (spend minus revenue) — the same formula the Finance seat prints.',
  'metric.netBurn': 'Net burn per month',
  'metric.grossSpend': 'Gross spend per month',
  'metric.zeroCash': 'Estimated zero-cash date',
  'metric.health': 'Health',
  'health.critical': 'Critical',
  'health.watch': 'Watch',
  'health.healthy': 'Healthy',
  'health.profitable': 'Profitable',
  'value.none': '—',
  'rec.critical.title': 'Start the raise now',
  'rec.critical.detail': 'Under six months, a round takes longer than the cash lasts. Open the round this week, cut the two largest discretionary lines, and list the company where investors can find it.',
  'rec.watch.title': 'Decide the plan before month six',
  'rec.watch.detail': 'Between six and twelve months you still choose the terms. Pick raise, revenue or cuts now — and set the milestone the next round needs to see.',
  'rec.healthy.title': 'Buy growth with the time you have',
  'rec.healthy.detail': 'More than a year of runway is an asset. Put it into the experiments that move revenue, and revisit this number every month.',
  'rec.profitable.title': 'Reinvest deliberately',
  'rec.profitable.detail': 'Revenue covers spend. Decide how much of the surplus to put back into growth, and keep a cash floor for the month it does not.',
  'rec.track.title': 'Track it from the books, not the form',
  'rec.track.detail': 'Connect your accounting or bank feed and the platform recomputes burn and runway daily from money that actually moved — beside the numbers you declared.',
} as const;

const runwayCalculator: CalculatorTool = {
  id: 'runway-calculator',
  kind: 'calculator',
  name: 'Runway Calculator',
  tagline: 'How many months of cash do you have, and when does it reach zero?',
  icon: '⏳',
  category: 'finance',
  about:
    'Enter cash on hand, monthly spend and monthly revenue to see your runway in months, the net burn that produced it and the approximate date cash reaches zero. It divides by NET burn — a company spending $100k and earning $80k is burning $20k, and dividing by gross spend would report a fifth of its real runway. Sign in and the same number is computed daily from your connected books.',
  copy: RUNWAY_COPY,
  inputs: [
    { id: 'cashOnHand', label: 'Cash on hand', type: 'number', unit: 'USD', min: 0, step: 10_000, default: 500_000 },
    { id: 'monthlySpend', label: 'Monthly spend (everything that leaves the account)', type: 'number', unit: 'USD', min: 0, step: 1_000, default: 60_000 },
    { id: 'monthlyRevenue', label: 'Monthly revenue', type: 'number', unit: 'USD', min: 0, step: 1_000, default: 20_000 },
  ],
  compute: (v): ToolResult => {
    const verdict = computeRunway({ cashOnHand: v.cashOnHand, monthlyBudget: v.monthlySpend, monthlyRevenue: v.monthlyRevenue });
    const rec = (key: 'critical' | 'watch' | 'healthy' | 'profitable' | 'track') =>
      ({ title: RUNWAY_COPY[`rec.${key}.title`], detail: RUNWAY_COPY[`rec.${key}.detail`] });
    const score = verdict.health === 'profitable' ? 5 : verdict.health === 'healthy' ? 4 : verdict.health === 'watch' ? 3 : 1;
    return {
      headline: verdict.runwayMonths === null
        ? RUNWAY_COPY['headline.profitable']
        : RUNWAY_COPY['headline.months'].replace('{months}', monthsLabel(verdict.runwayMonths)),
      summary: RUNWAY_COPY.summary,
      score,
      scoreLabel: RUNWAY_COPY[`health.${verdict.health}`],
      metrics: [
        { label: RUNWAY_COPY['metric.netBurn'], value: money(Math.max(0, verdict.netBurn)) },
        { label: RUNWAY_COPY['metric.grossSpend'], value: money(clamp(v.monthlySpend, 0)) },
        { label: RUNWAY_COPY['metric.zeroCash'], value: verdict.zeroCashDate ? verdict.zeroCashDate.slice(0, 10) : RUNWAY_COPY['value.none'] },
        { label: RUNWAY_COPY['metric.health'], value: RUNWAY_COPY[`health.${verdict.health}`], tier: score },
      ],
      recommendations: [rec(verdict.health), rec('track')],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Burn rate
// ─────────────────────────────────────────────────────────────────────────────

const BURN_COPY = {
  headline: '{net} net burn per month',
  'headline.covered': 'Revenue covers spend',
  summary: 'Gross burn is everything that leaves; net burn is what revenue does not cover. Payroll is usually the largest line, which is why it is asked for separately.',
  'metric.gross': 'Gross burn',
  'metric.net': 'Net burn',
  'metric.coverage': 'Revenue coverage of spend',
  'metric.payrollShare': 'Payroll share of spend',
  'metric.annual': 'Annualised net burn',
  'rec.payroll.title': 'Headcount is the lever',
  'rec.payroll.detail': 'Payroll is {share} of spend. Every hire moves the runway more than any tool or office line — decide the next hire against the months it costs.',
  'rec.coverage.title': 'Revenue is the lever',
  'rec.coverage.detail': 'Revenue covers {coverage} of spend. Each point of coverage is runway you do not have to raise; price, retention and collections move it fastest.',
  'rec.covered.title': 'Protect the margin',
  'rec.covered.detail': 'You are default alive. Keep a cash floor for a bad quarter and let the surplus fund the experiments that grow revenue.',
  'rec.categorise.title': 'Categorise spend so the trend is real',
  'rec.categorise.detail': 'Approve expenses and process payroll in the workspace, or connect the books, and the platform shows burn by category month over month — spikes show before they eat a month of runway.',
} as const;

const burnRateCalculator: CalculatorTool = {
  id: 'burn-rate-calculator',
  kind: 'calculator',
  name: 'Burn Rate Calculator',
  tagline: 'Gross burn, net burn, and which line moves them.',
  icon: '🔥',
  category: 'finance',
  about:
    'Split your monthly spend into payroll, tools and infrastructure, and everything else, then enter monthly revenue. You get gross burn, net burn, how much of spend revenue covers, and the share payroll takes — the number that tells you whether the next lever is a hire or a price.',
  copy: BURN_COPY,
  inputs: [
    { id: 'payroll', label: 'Payroll and benefits per month', type: 'number', unit: 'USD', min: 0, step: 1_000, default: 40_000 },
    { id: 'toolsAndInfra', label: 'Tools, infrastructure and vendors per month', type: 'number', unit: 'USD', min: 0, step: 500, default: 8_000 },
    { id: 'other', label: 'Office, travel and everything else per month', type: 'number', unit: 'USD', min: 0, step: 500, default: 6_000 },
    { id: 'monthlyRevenue', label: 'Monthly revenue', type: 'number', unit: 'USD', min: 0, step: 1_000, default: 15_000 },
  ],
  compute: (v): ToolResult => {
    const payroll = clamp(v.payroll, 0);
    const gross = payroll + clamp(v.toolsAndInfra, 0) + clamp(v.other, 0);
    const revenue = clamp(v.monthlyRevenue, 0);
    const net = gross - revenue;
    const coverage = gross > 0 ? Math.min(1, revenue / gross) : 1;
    const payrollShare = gross > 0 ? payroll / gross : 0;
    const recs: ToolResult['recommendations'] = [];
    if (net <= 0) recs.push({ title: BURN_COPY['rec.covered.title'], detail: BURN_COPY['rec.covered.detail'] });
    else {
      if (payrollShare >= 0.6) recs.push({ title: BURN_COPY['rec.payroll.title'], detail: BURN_COPY['rec.payroll.detail'].replace('{share}', percent(payrollShare)) });
      if (coverage < 0.5) recs.push({ title: BURN_COPY['rec.coverage.title'], detail: BURN_COPY['rec.coverage.detail'].replace('{coverage}', percent(coverage)) });
    }
    recs.push({ title: BURN_COPY['rec.categorise.title'], detail: BURN_COPY['rec.categorise.detail'] });
    return {
      headline: net <= 0 ? BURN_COPY['headline.covered'] : BURN_COPY.headline.replace('{net}', money(net)),
      summary: BURN_COPY.summary,
      metrics: [
        { label: BURN_COPY['metric.gross'], value: money(gross) },
        { label: BURN_COPY['metric.net'], value: money(Math.max(0, net)) },
        { label: BURN_COPY['metric.coverage'], value: percent(coverage) },
        { label: BURN_COPY['metric.payrollShare'], value: percent(payrollShare) },
        { label: BURN_COPY['metric.annual'], value: money(Math.max(0, net) * 12) },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Break-even
// ─────────────────────────────────────────────────────────────────────────────

const BREAK_EVEN_COPY = {
  headline: '{units} units a month to break even',
  'headline.never': 'No break-even at this price — each unit loses money',
  'headline.now': 'Already past break-even',
  summary: 'Break-even units = fixed monthly costs ÷ contribution margin per unit. Months to break-even walks your current volume forward at the growth rate you entered.',
  'metric.margin': 'Contribution margin per unit',
  'metric.marginPct': 'Contribution margin',
  'metric.gap': 'Units short of break-even today',
  'metric.months': 'Months to break-even at this growth',
  'metric.revenue': 'Break-even revenue per month',
  'value.never': 'Never',
  'value.now': 'Now',
  'value.beyond': 'More than {cap}',
  'rec.margin.title': 'Fix the unit economics first',
  'rec.margin.detail': 'A contribution margin under 30% means growth barely moves break-even. Raise the price, cut the variable cost, or change what a unit is before you buy volume.',
  'rec.negative.title': 'Every sale deepens the hole',
  'rec.negative.detail': 'Variable cost exceeds price. No volume fixes this — reprice or restructure the offer before spending on acquisition.',
  'rec.growth.title': 'Growth alone is too slow',
  'rec.growth.detail': 'At this growth rate break-even is more than two years out. Pair growth with a fixed-cost cut or a price change, and check the runway covers the gap.',
  'rec.near.title': 'Break-even is within reach',
  'rec.near.detail': 'Under twelve months at the current pace. Protect the growth rate and hold fixed costs flat until you cross it.',
  'rec.scenario.title': 'Model it as a scenario',
  'rec.scenario.detail': 'In the workspace, break-even is a scenario with declared assumptions and a baseline — compare price, cost and growth cases side by side.',
} as const;

const MAX_MONTHS = 120;

const breakEvenCalculator: CalculatorTool = {
  id: 'break-even-calculator',
  kind: 'calculator',
  name: 'Break-Even Calculator',
  tagline: 'How many units, and how many months, until revenue meets cost?',
  icon: '⚖️',
  category: 'finance',
  about:
    'Enter fixed monthly costs, price and variable cost per unit, your current monthly volume and its growth rate. You get the contribution margin, the units per month that cover fixed costs, and how many months of growth reach them — the honest version of "when do we stop losing money".',
  copy: BREAK_EVEN_COPY,
  inputs: [
    { id: 'fixedCosts', label: 'Fixed costs per month', type: 'number', unit: 'USD', min: 0, step: 1_000, default: 50_000 },
    { id: 'pricePerUnit', label: 'Price per unit (per customer, per month)', type: 'number', unit: 'USD', min: 0, step: 10, default: 200 },
    { id: 'variableCostPerUnit', label: 'Variable cost per unit', type: 'number', unit: 'USD', min: 0, step: 5, default: 40 },
    { id: 'currentUnits', label: 'Units sold per month today', type: 'number', min: 0, step: 10, default: 120 },
    { id: 'monthlyGrowthPct', label: 'Monthly growth in units', type: 'number', unit: '%', min: 0, max: 100, step: 1, default: 8 },
  ],
  compute: (v): ToolResult => {
    const fixed = clamp(v.fixedCosts, 0);
    const price = clamp(v.pricePerUnit, 0);
    const variable = clamp(v.variableCostPerUnit, 0);
    const current = clamp(v.currentUnits, 0);
    const growth = clamp(v.monthlyGrowthPct, 0, 100) / 100;
    const margin = price - variable;
    const marginPct = price > 0 ? margin / price : 0;
    const rec = (key: 'margin' | 'negative' | 'growth' | 'near' | 'scenario') =>
      ({ title: BREAK_EVEN_COPY[`rec.${key}.title`], detail: BREAK_EVEN_COPY[`rec.${key}.detail`] });

    if (margin <= 0) {
      return {
        headline: BREAK_EVEN_COPY['headline.never'],
        summary: BREAK_EVEN_COPY.summary,
        metrics: [
          { label: BREAK_EVEN_COPY['metric.margin'], value: money(margin) },
          { label: BREAK_EVEN_COPY['metric.marginPct'], value: percent(marginPct) },
          { label: BREAK_EVEN_COPY['metric.months'], value: BREAK_EVEN_COPY['value.never'] },
        ],
        recommendations: [rec('negative'), rec('scenario')],
      };
    }

    const breakEvenUnits = Math.ceil(fixed / margin);
    let months = 0;
    let units = current;
    if (units < breakEvenUnits) {
      if (growth <= 0) months = Number.POSITIVE_INFINITY;
      else while (units < breakEvenUnits && months < MAX_MONTHS) { units *= 1 + growth; months += 1; }
      if (months >= MAX_MONTHS && units < breakEvenUnits) months = Number.POSITIVE_INFINITY;
    }
    const monthsValue = current >= breakEvenUnits
      ? BREAK_EVEN_COPY['value.now']
      : Number.isFinite(months) ? String(months) : BREAK_EVEN_COPY['value.beyond'].replace('{cap}', String(MAX_MONTHS));

    const recs: ToolResult['recommendations'] = [];
    if (marginPct < 0.3) recs.push(rec('margin'));
    if (current < breakEvenUnits && (!Number.isFinite(months) || months > 24)) recs.push(rec('growth'));
    if (current < breakEvenUnits && Number.isFinite(months) && months <= 12) recs.push(rec('near'));
    recs.push(rec('scenario'));

    return {
      headline: current >= breakEvenUnits
        ? BREAK_EVEN_COPY['headline.now']
        : BREAK_EVEN_COPY.headline.replace('{units}', breakEvenUnits.toLocaleString('en-US')),
      summary: BREAK_EVEN_COPY.summary,
      metrics: [
        { label: BREAK_EVEN_COPY['metric.margin'], value: money(margin) },
        { label: BREAK_EVEN_COPY['metric.marginPct'], value: percent(marginPct) },
        { label: BREAK_EVEN_COPY['metric.gap'], value: Math.max(0, breakEvenUnits - Math.floor(current)).toLocaleString('en-US') },
        { label: BREAK_EVEN_COPY['metric.months'], value: monthsValue },
        { label: BREAK_EVEN_COPY['metric.revenue'], value: money(breakEvenUnits * price) },
      ],
      recommendations: recs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Churn
// ─────────────────────────────────────────────────────────────────────────────

const CHURN_COPY = {
  headline: '{churn} monthly churn',
  summary: 'Monthly churn = customers lost ÷ customers at the start of the month. Lifetime and LTV follow from it: a customer stays, on average, one over the churn rate.',
  'metric.annual': 'Annualised churn',
  'metric.lifetime': 'Average customer lifetime',
  'metric.ltv': 'Customer lifetime value',
  'metric.lost': 'Revenue lost this month',
  'unit.months': '{n} months',
  'rec.high.title': 'Retention before acquisition',
  'rec.high.detail': 'Above 5% a month you lose most of a cohort within a year. Every acquisition dollar leaks; find the first ninety days’ drop-off before buying more customers.',
  'rec.watch.title': 'Find the churn cohort',
  'rec.watch.detail': 'Between 2% and 5% is survivable but expensive. Segment churn by plan, acquisition channel and tenure — one cohort usually carries most of it.',
  'rec.good.title': 'Compounding is on your side',
  'rec.good.detail': 'Under 2% a month is strong retention. Grow the base and watch for a rise as you move upmarket or change pricing.',
  'rec.predict.title': 'Predict it before the renewal call',
  'rec.predict.detail': 'In the workspace, churn prediction scores each account from usage and support signals, and a high-risk score can trigger a win-back sequence automatically.',
} as const;

const churnCalculator: CalculatorTool = {
  id: 'churn-calculator',
  kind: 'calculator',
  name: 'Churn Calculator',
  tagline: 'Monthly and annual churn, customer lifetime, and what a customer is worth.',
  icon: '🔁',
  category: 'finance',
  about:
    'Enter how many customers you started the month with, how many you lost, and the average monthly revenue per customer. You get monthly and annualised churn, the average lifetime a customer stays, and the lifetime value that implies — the number CAC has to beat.',
  copy: CHURN_COPY,
  inputs: [
    { id: 'customersStart', label: 'Customers at the start of the month', type: 'number', min: 1, step: 1, default: 400 },
    { id: 'customersLost', label: 'Customers lost during the month', type: 'number', min: 0, step: 1, default: 12 },
    { id: 'arpu', label: 'Average revenue per customer per month', type: 'number', unit: 'USD', min: 0, step: 5, default: 90 },
  ],
  compute: (v): ToolResult => {
    const start = clamp(v.customersStart, 1);
    const lost = clamp(v.customersLost, 0, start);
    const arpu = clamp(v.arpu, 0);
    const monthly = lost / start;
    const annual = 1 - Math.pow(1 - monthly, 12);
    const lifetime = monthly > 0 ? Math.min(240, 1 / monthly) : 240;
    const ltv = arpu * lifetime;
    const band = monthly > 0.05 ? 'high' : monthly >= 0.02 ? 'watch' : 'good';
    const rec = (key: 'high' | 'watch' | 'good' | 'predict') => ({ title: CHURN_COPY[`rec.${key}.title`], detail: CHURN_COPY[`rec.${key}.detail`] });
    return {
      headline: CHURN_COPY.headline.replace('{churn}', percent(monthly)),
      summary: CHURN_COPY.summary,
      score: band === 'good' ? 5 : band === 'watch' ? 3 : 1,
      metrics: [
        { label: CHURN_COPY['metric.annual'], value: percent(annual) },
        { label: CHURN_COPY['metric.lifetime'], value: CHURN_COPY['unit.months'].replace('{n}', monthsLabel(lifetime)) },
        { label: CHURN_COPY['metric.ltv'], value: money(ltv) },
        { label: CHURN_COPY['metric.lost'], value: money(lost * arpu) },
      ],
      recommendations: [rec(band), rec('predict')],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pricing simulator
// ─────────────────────────────────────────────────────────────────────────────

const PRICING_COPY = {
  headline: 'MRR {before} → {after}',
  summary: 'The proposed price applied to today’s customers, with the churn change you expect. LTV = price ÷ monthly churn; payback = CAC ÷ price. Every figure is a projection at the inputs you entered.',
  'metric.ltvBefore': 'LTV today',
  'metric.ltvAfter': 'LTV at the new price',
  'metric.ratioBefore': 'LTV : CAC today',
  'metric.ratioAfter': 'LTV : CAC at the new price',
  'metric.payback': 'CAC payback at the new price',
  'unit.months': '{n} months',
  'rec.ratioLow.title': 'Acquisition does not pay back',
  'rec.ratioLow.detail': 'An LTV : CAC below 3 means each customer barely returns what it cost to win. Raise price, cut churn or cut CAC before scaling spend.',
  'rec.paybackLong.title': 'Payback is longer than a year',
  'rec.paybackLong.detail': 'A payback over twelve months ties runway up in customers you have not yet earned back. Annual prepay, a higher entry price or a cheaper channel shortens it.',
  'rec.churnRisk.title': 'The price only works if churn holds',
  'rec.churnRisk.detail': 'Your projection assumes churn rises by {delta} points. Test the new price on new customers first and watch the first-quarter retention before moving the base.',
  'rec.good.title': 'The new price improves the economics',
  'rec.good.detail': 'LTV : CAC and payback both improve. Roll it out to new customers first, then grandfather or migrate the base with notice.',
  'rec.simulate.title': 'Compare cases in a scenario',
  'rec.simulate.detail': 'In the workspace, pricing is a scenario with declared assumptions — keep a baseline and compare two or three price points against churn and CAC.',
} as const;

const pricingSimulator: CalculatorTool = {
  id: 'pricing-simulator',
  kind: 'calculator',
  name: 'Pricing Simulator',
  tagline: 'What a price change does to MRR, LTV, LTV : CAC and payback.',
  icon: '🏷️',
  category: 'finance',
  about:
    'Enter today’s price, customers, monthly churn and CAC, then the price you are considering and how much churn you expect it to add. You see MRR before and after, lifetime value, LTV : CAC and CAC payback — the four numbers a pricing decision turns on — before you change anything for a customer.',
  copy: PRICING_COPY,
  inputs: [
    { id: 'currentPrice', label: 'Current price per customer per month', type: 'number', unit: 'USD', min: 0, step: 5, default: 80 },
    { id: 'customers', label: 'Paying customers', type: 'number', min: 0, step: 10, default: 300 },
    { id: 'monthlyChurnPct', label: 'Monthly churn today', type: 'number', unit: '%', min: 0.1, max: 100, step: 0.5, default: 3 },
    { id: 'cac', label: 'Customer acquisition cost', type: 'number', unit: 'USD', min: 0, step: 50, default: 900 },
    { id: 'proposedPrice', label: 'Proposed price per customer per month', type: 'number', unit: 'USD', min: 0, step: 5, default: 110 },
    { id: 'churnChangePts', label: 'Expected change in monthly churn', type: 'number', unit: 'pts', min: -50, max: 50, step: 0.5, default: 0.5 },
  ],
  compute: (v): ToolResult => {
    const price = clamp(v.currentPrice, 0);
    const customers = clamp(v.customers, 0);
    const churn = clamp(v.monthlyChurnPct, 0.1, 100) / 100;
    const cac = clamp(v.cac, 0);
    const proposed = clamp(v.proposedPrice, 0);
    const delta = clamp(v.churnChangePts, -50, 50);
    const churnAfter = Math.min(1, Math.max(0.001, churn + delta / 100));
    const mrrBefore = price * customers;
    const mrrAfter = proposed * customers;
    const ltvBefore = price / churn;
    const ltvAfter = proposed / churnAfter;
    const ratioBefore = cac > 0 ? ltvBefore / cac : Number.POSITIVE_INFINITY;
    const ratioAfter = cac > 0 ? ltvAfter / cac : Number.POSITIVE_INFINITY;
    const payback = proposed > 0 ? cac / proposed : Number.POSITIVE_INFINITY;
    const ratio = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 10) / 10} : 1` : '—');
    const rec = (key: 'ratioLow' | 'paybackLong' | 'churnRisk' | 'good' | 'simulate') =>
      ({ title: PRICING_COPY[`rec.${key}.title`], detail: PRICING_COPY[`rec.${key}.detail`].replace('{delta}', String(delta)) });
    const recs: ToolResult['recommendations'] = [];
    if (ratioAfter < 3) recs.push(rec('ratioLow'));
    if (payback > 12) recs.push(rec('paybackLong'));
    if (delta > 0) recs.push(rec('churnRisk'));
    if (ratioAfter >= ratioBefore && payback <= cac / Math.max(price, 0.01) && recs.length === 0) recs.push(rec('good'));
    recs.push(rec('simulate'));
    return {
      headline: PRICING_COPY.headline.replace('{before}', money(mrrBefore)).replace('{after}', money(mrrAfter)),
      summary: PRICING_COPY.summary,
      metrics: [
        { label: PRICING_COPY['metric.ltvBefore'], value: money(ltvBefore) },
        { label: PRICING_COPY['metric.ltvAfter'], value: money(ltvAfter) },
        { label: PRICING_COPY['metric.ratioBefore'], value: ratio(ratioBefore) },
        { label: PRICING_COPY['metric.ratioAfter'], value: ratio(ratioAfter) },
        { label: PRICING_COPY['metric.payback'], value: PRICING_COPY['unit.months'].replace('{n}', monthsLabel(Number.isFinite(payback) ? payback : null)) },
      ],
      recommendations: recs,
    };
  },
};

/** The five, in the order a founder meets the questions. */
export const STARTUP_FINANCE_TOOLS: CalculatorTool[] = [
  runwayCalculator,
  burnRateCalculator,
  breakEvenCalculator,
  churnCalculator,
  pricingSimulator,
];
