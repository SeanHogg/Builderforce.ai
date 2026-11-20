/**
 * The Measure-PRD founder kinds — how big the market is (`marketSize`) and who takes
 * what at an exit (`exitScenario`), PRD 25 §5.5 and §6.3.
 *
 * Declared here rather than inline in `founderObjects.ts` because they are their own
 * concern with their own readers (the deck's market slide, the equity waterfall), and
 * the founder spec file is the one everyone edits. `FOUNDER_OBJECT_SPECS` lists them in
 * place, so ordering, registration and the field contract are unchanged: this module
 * only DECLARES two entries; the founder vocabulary still owns them.
 */

import {
  MARKET_SIZE_METHODS,
  computeMarketSize,
  marketSizeInputsFrom,
  marketSizeVerdicts,
} from '@builderforce/creation-canvas-contract';
import type { FounderObjectSpec } from './founderObjects';
import { EXACT_MONEY_HINT } from './founderMoneyFields';
import { SOURCES_FIELD, SUMMARY_FIELD } from './specObjects';
import { specVerdict } from './specVerdict';

/**
 * How big the market is, both ways (PRD 25 §5.5).
 *
 * Inputs are authored; TAM / SAM / SOM and the triangulation gap are `derive`d through the
 * contract's `computeMarketSize`, the SAME function the deck's market slide reads. A missing
 * input yields `undefined`, never 0. SOM <= SAM <= TAM is enforced as a verdict.
 */
export const MARKET_SIZE_SPEC: FounderObjectSpec = {
  kind: 'marketSize',
  icon: '◔',
  group: 'Insights',
  defaultStatus: 'sizing',
  actions: ['size', 'review'],
  fields: [
    { name: 'method', render: 'stat', label: 'method', hint: `Which method is primary: ${MARKET_SIZE_METHODS.join(' | ')}. Bottom-up (customers × ARPA) is primary; top-down triangulates it.` },
    { name: 'potentialCustomers', render: 'stat', label: 'potentialCustomers', hint: 'All potential customers worldwide/in scope, as a plain integer. Drives TAM. Leave empty rather than guessing.' },
    { name: 'serviceableCustomers', render: 'stat', label: 'serviceableCustomers', hint: 'Customers the product can serve today (geography, segment, regulation), a plain integer. Drives SAM. Must not exceed potentialCustomers.' },
    { name: 'reachableCustomers', render: 'stat', label: 'reachableCustomers', hint: 'Customers the go-to-market can actually reach in the plan horizon, a plain integer. Drives SOM and should be tied to the gtmPlan.' },
    { name: 'arpa', render: 'stat', label: 'arpa', hint: 'Average revenue per account per YEAR, a plain number in major units. Used for TAM, SAM and SOM.' },
    { name: 'achievableShare', render: 'stat', label: 'achievableShare', hint: 'Share of the reachable customers the plan can win, as a fraction (0.05) or whole percent (5).' },
    { name: 'topDownMarket', render: 'stat', label: 'topDownMarket', hint: 'A CITED market figure for the top-down cross-check, a plain number. Cite it in `sources`.' },
    { name: 'topDownShare', render: 'stat', label: 'topDownShare', hint: 'The share of that market this company can reach, as a fraction (0.0025) or whole percent.' },
    {
      name: 'tam', render: 'stat', label: 'tam', derived: true,
      hint: 'COMPUTED. Total addressable market = potentialCustomers × arpa. Empty when an input is missing.',
      derive: (data) => computeMarketSize(marketSizeInputsFrom(data)).tam,
    },
    {
      name: 'sam', render: 'stat', label: 'sam', derived: true,
      hint: 'COMPUTED. Serviceable addressable market = serviceableCustomers × arpa.',
      derive: (data) => computeMarketSize(marketSizeInputsFrom(data)).sam,
    },
    {
      name: 'som', render: 'stat', label: 'som', derived: true,
      hint: 'COMPUTED. Serviceable obtainable market = reachableCustomers × arpa × achievableShare.',
      derive: (data) => computeMarketSize(marketSizeInputsFrom(data)).som,
    },
    {
      name: 'triangulationGap', render: 'stat', label: 'triangulationGap', derived: true,
      hint: 'COMPUTED. Fractional gap between bottom-up SOM and top-down (topDownMarket × topDownShare). Within 0.15 is a health mark.',
      derive: (data) => computeMarketSize(marketSizeInputsFrom(data)).triangulationGap,
    },
    {
      name: 'sizeCheck', render: 'verdict', label: 'sizeCheck',
      hint: 'COMPUTED. Whether SOM <= SAM <= TAM holds (otherwise `inconsistent`) and whether the two methods agree within 15%.',
      derive: (data) => {
        const verdicts = marketSizeVerdicts(computeMarketSize(marketSizeInputsFrom(data)));
        return verdicts.length ? verdicts.map((key) => specVerdict(`marketSize.${key}`)) : undefined;
      },
    },
    SUMMARY_FIELD,
    SOURCES_FIELD,
  ],
};

/**
 * Who takes what at an exit (PRD 25 §6.3).
 *
 * Inputs only. The founder / investor / pool payouts are computed server-side by
 * `POST /api/equity/waterfall` from the cap table and are NEVER stored on the card.
 */
export const EXIT_SCENARIO_SPEC: FounderObjectSpec = {
  kind: 'exitScenario',
  icon: '⇱',
  group: 'Work',
  defaultStatus: 'modelling',
  actions: ['model'],
  fields: [
    { name: 'companyRef', render: 'stat', label: 'companyRef', hint: 'Which company this scenario is for — the same ref the `capTable` uses. Payouts are derived from that cap table, never typed.', bookkeeping: true },
    { name: 'exitValue', render: 'stat', label: 'exitValue', hint: EXACT_MONEY_HINT },
    { name: 'debt', render: 'stat', label: 'debt', hint: 'Debt repaid ahead of every share class at exit, a plain number in major units. Empty means none declared.' },
    { name: 'vesting', render: 'stat', label: 'vesting', hint: 'How unvested options are treated at the exit: normal | accelerated.' },
    SUMMARY_FIELD,
  ],
};
