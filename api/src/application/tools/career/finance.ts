/**
 * Career analyzers about MONEY — the salary band and the personal runway. Adapters
 * only; every measurement is an `application/career` function (see the header of
 * `../careerTools.ts`).
 */
import { analyzeSalary, computeRunway } from '../../career';
import { enumSlug } from '../analyzerCopy';
import type { AnalyzerTool } from '../toolTypes';
import { countMetric, counted, instructionRec, listMetric, needsInput, num, text } from './helpers';

// ── 13. Salary Calculator ─────────────────────────────────────────────────────

export const salaryCalculator: AnalyzerTool = {
  id: 'salary-calculator',
  name: 'Salary Calculator',
  tagline: 'Model a band for a role and place your number inside it.',
  icon: '💰',
  category: 'career',
  kind: 'analyzer',
  about:
    'Models an annual base band from discipline, seniority, region and work mode, and shows every multiplier that produced it — so the number is one you can argue with rather than one you have to trust. Supply a current or offered figure and it places it in the band by percentile.',
  fields: [
    { id: 'discipline', label: 'Role or discipline', type: 'line', required: true, placeholder: 'Product Manager' },
    { id: 'seniority', label: 'Seniority', type: 'line', required: false, placeholder: 'senior' },
    { id: 'location', label: 'Location', type: 'line', required: false, placeholder: 'Austin, TX' },
    {
      id: 'workMode', label: 'Work mode', type: 'select', required: false,
      options: [
        { value: 'hybrid', label: 'Hybrid' },
        { value: 'remote', label: 'Remote' },
        { value: 'onsite', label: 'On site' },
      ],
    },
    { id: 'currentBase', label: 'Current or offered base', type: 'line', required: false, placeholder: 'Optional — e.g. 150000' },
  ],
  copy: {
    needsInput: 'Name a role or discipline to see the result.',
    money: '{currency} {amount}',
    summary: '{seniority} {discipline}, {region}, {workMode}. {basis}',
    low: 'Low (P25)',
    median: 'Median (P50)',
    high: 'High (P75)',
    yourFigure: 'Your figure',
    yourFigureValue: '{amount} · P{percentile}',
    assumptions: 'Assumptions',
    anchorTitle: 'Anchor at the upper quartile',
    anchorDetail: 'If you name a number first, {amount} is the anchor this band supports — not the median. Give a range whose bottom you would still accept.',
  },
  analyze: (values, c) => {
    const discipline = text(values, 'discipline');
    if (!discipline) return needsInput(c);
    const mode = text(values, 'workMode');
    const analysis = analyzeSalary({
      discipline,
      seniority: text(values, 'seniority') || undefined,
      location: text(values, 'location') || undefined,
      workMode: mode === 'remote' || mode === 'onsite' ? mode : 'hybrid',
      currentBase: num(values, 'currentBase'),
    });
    // Currency SYMBOL placement differs by language (`1 234 € ` in French,
    // `€1,234` in English), so the money template is copy and the digit grouping
    // is the reader's, not en-US's.
    const money = (n: number) => c('money', { currency: analysis.band.currency, amount: n.toLocaleString(c.locale) });
    return {
      headline: money(analysis.band.median),
      summary: c('summary', {
        seniority: analysis.seniority,
        discipline: analysis.discipline,
        region: analysis.region,
        workMode: c.option('workMode', analysis.workMode),
        basis: analysis.basis,
      }),
      score: null,
      scoreLabel: null,
      metrics: [
        countMetric(c('low'), money(analysis.band.low)),
        countMetric(c('median'), money(analysis.band.median)),
        countMetric(c('high'), money(analysis.band.high)),
        ...(analysis.position
          ? [countMetric(c('yourFigure'), c('yourFigureValue', { amount: money(analysis.position.value), percentile: analysis.position.percentile }), analysis.position.verdict)]
          : []),
        listMetric(c, c('assumptions'), analysis.assumptions, c('none')),
      ],
      recommendations: [
        {
          title: c('anchorTitle'),
          detail: c('anchorDetail', { amount: money(analysis.band.high) }),
          priority: 'high',
        },
        ...instructionRec(c, analysis.instruction),
      ],
    };
  },
};

// ── 13b. Personal Runway ──────────────────────────────────────────────────────
//
// The one free tool in this catalogue that is not about a document.
//
// Fifteen of the sixteen entries around it read a resume, a posting or a market
// band -- all of them questions about the SEARCH. This is the question that decides
// how the search is run at all, and it is the one nobody puts in a tool because the
// inputs are embarrassing: how much money is left, and what leaves the account each
// month. Under about thirteen weeks, taking contract work while interviewing beats
// holding out for the right salaried role, and somebody who does not know which side
// of that line they are on spends the runway finding out.
//
// It leads with WEEKS rather than currency for the reason `application/career/runway.ts`
// argues: a balance is a number you can feel good about and a number of weeks is a
// decision. Nothing here is stored -- the compute is pure and the page is the free,
// no-login surface, which for this particular input is the whole point.

export const personalRunway: AnalyzerTool = {
  id: 'personal-runway',
  name: 'Personal Runway',
  tagline: 'How many weeks does the money last, and what that means for the search.',
  icon: '⏳',
  category: 'career',
  kind: 'analyzer',
  about:
    'Projects your balance forward month by month from savings, monthly outgoings and any income still arriving, and reports the weeks remaining plus the pressure band the rest of a job search should be paced against. Every figure is one you supplied — nothing is estimated on your behalf, and nothing is stored.',
  fields: [
    { id: 'savings', label: 'Cash available now', type: 'line', required: true, placeholder: 'Savings, notice pay — anything already banked' },
    { id: 'monthlyExpenses', label: 'Monthly outgoings', type: 'line', required: true, placeholder: 'Everything that leaves in a normal month, incl. annual bills ÷ 12' },
    { id: 'monthlyIncome', label: 'Monthly income still arriving', type: 'line', required: false, placeholder: 'Optional — benefits, a partner’s contribution, residual income' },
    { id: 'currency', label: 'Currency', type: 'line', required: false, placeholder: 'GBP' },
  ],
  copy: {
    needsInput: 'Enter the cash you have now and what leaves the account each month to see the result.',
    money: '{currency} {amount}',
    headlineSolvent: 'The money is not running out',
    'headlineWeeks.one': '{n} week',
    'headlineWeeks.other': '{n} weeks',
    summarySolvent: 'Income covers the outgoings, so there is no cliff to plan against. Net position {amount} a month.',
    summaryBurn: 'Net burn {burn} a month against {savings}.',
    summaryCliff: 'The balance reaches zero in month {month}.',
    weeks: 'Weeks remaining',
    weeksHint: 'The number every other career decision is paced against.',
    months: 'Months remaining',
    burn: 'Net monthly burn',
    burnNone: 'None — income covers it',
    pressure: 'Pressure',
    pressureHint: 'Under about 13 weeks, contract work while interviewing usually beats holding out.',
    assumptions: 'Assumptions',
    bridgeTitle: 'Take the bridge work and keep interviewing',
    bridgeDetail: 'With {weeks} weeks left, a salaried role that starts in three months arrives after the balance does. Contract or part-time work that starts sooner buys the runway to hold out for the right permanent role instead of accepting the first one.',
    targetedTitle: 'Search for the right role, not any role',
    targetedDetail: 'The runway supports a targeted search. Spend the time on fewer, better-tailored applications — the reply rate on a tailored application is several times that of a volume one, and you can afford to find out which.',
    statementTitle: 'Check the outgoings against a real statement',
    statementDetail: 'The single most common error in this calculation is an under-stated monthly figure, because the annual bills are forgotten. Divide them by twelve and add them in before trusting the weeks above.',
    'pressure.none': 'None',
    'pressure.comfortable': 'Comfortable',
    'pressure.planning': 'Planning',
    'pressure.urgent': 'Urgent',
    'pressure.critical': 'Critical',
  },
  analyze: (values, c) => {
    const savings = num(values, 'savings');
    const monthlyExpenses = num(values, 'monthlyExpenses');
    if (savings === undefined || monthlyExpenses === undefined) return needsInput(c);

    const reading = computeRunway({
      savings,
      monthlyExpenses,
      monthlyIncome: num(values, 'monthlyIncome'),
      currency: text(values, 'currency') || undefined,
    });
    const amount = (n: number) => c('money', { currency: reading.currency, amount: Math.round(n).toLocaleString(c.locale) });
    const pressure = c(enumSlug('pressure', reading.pressure));

    // The bands are the domain's, restated ONLY as a tier for the shared meter. A
    // second set of thresholds here would let the page disagree with the same reading
    // taken through `hr.runway` or drawn on a canvas `runway` card.
    const PRESSURE_TIER: Record<string, number> = { none: 5, comfortable: 4, planning: 3, urgent: 2, critical: 1 };
    const cliff = reading.projection.find((month) => month.balance <= 0);
    // Two whole sentences joined, never one sentence assembled from fragments:
    // the cliff clause is optional, so it has to stand on its own.
    const burnSummary = [
      c('summaryBurn', { burn: amount(reading.netMonthlyBurn), savings: amount(savings) }),
      cliff ? c('summaryCliff', { month: cliff.month }) : '',
    ].filter(Boolean).join(' ');

    return {
      headline: reading.weeksRemaining === null
        ? c('headlineSolvent')
        : counted(c, 'headlineWeeks', reading.weeksRemaining),
      summary: reading.weeksRemaining === null
        ? c('summarySolvent', { amount: amount(-reading.netMonthlyBurn) })
        : burnSummary,
      score: reading.weeksRemaining === null ? null : Math.min(100, Math.round((reading.weeksRemaining / 52) * 100)),
      scoreLabel: pressure,
      metrics: [
        { label: c('weeks'), value: reading.weeksRemaining === null ? '—' : reading.weeksRemaining.toLocaleString(c.locale), hint: c('weeksHint'), tier: PRESSURE_TIER[reading.pressure] },
        countMetric(c('months'), reading.monthsRemaining === null ? '—' : reading.monthsRemaining.toLocaleString(c.locale)),
        countMetric(c('burn'), reading.netMonthlyBurn <= 0 ? c('burnNone') : amount(reading.netMonthlyBurn)),
        { label: c('pressure'), value: pressure, hint: c('pressureHint'), tier: PRESSURE_TIER[reading.pressure] },
        listMetric(c, c('assumptions'), reading.assumptions, c('none')),
      ],
      recommendations: [
        ...(reading.weeksRemaining !== null && reading.weeksRemaining < 13
          ? [{
            title: c('bridgeTitle'),
            detail: c('bridgeDetail', { weeks: reading.weeksRemaining }),
            priority: 'high' as const,
          }]
          : []),
        ...(reading.weeksRemaining !== null && reading.weeksRemaining >= 26
          ? [{
            title: c('targetedTitle'),
            detail: c('targetedDetail'),
            priority: 'medium' as const,
          }]
          : []),
        {
          title: c('statementTitle'),
          detail: c('statementDetail'),
          priority: 'medium' as const,
        },
        ...instructionRec(c, reading.instruction),
      ],
    };
  },
};
