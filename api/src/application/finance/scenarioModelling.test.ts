/**
 * Scenario and churn invariants (PRD 19 §9 — the CFO's forward-looking half).
 *
 * These fail a BOARD MEETING rather than a build:
 *
 *   - the baseline must be exclusive, or every comparison in the module silently
 *     halves in meaning;
 *   - a Monte Carlo run must be reproducible from its stored seed, or a
 *     percentile somebody was shown can never be re-derived;
 *   - "does not break even" and "breaks even at the edge of the horizon" must not
 *     collapse, because the first is the scenario worth seeing;
 *   - a churn model must be scoreable, or it is a number that always sounds
 *     plausible and never improves;
 *   - nothing here may claim to be computed from a ledger — the Claim-to-Proof
 *     gate, which is a promise to customers rather than a style preference.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ASSUMPTION_ROLES,
  SCENARIO_KINDS,
  SCENARIO_PROVENANCE,
  ScenarioError,
  isAssumptionRole,
  isScenarioKind,
  scenarioProvenance,
} from './scenarioModelling';
import { OUTCOMES, RISK_BANDS, bandFor, isOutcome } from './churnPrediction';

const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const scenarios = read(resolve(__dirname, 'scenarioModelling.ts'));
const churn = read(resolve(__dirname, 'churnPrediction.ts'));
const routes = read(resolve(__dirname, '..', '..', 'presentation', 'routes', 'scenarioRoutes.ts'));

/** Source with comments removed, for assertions about what the code DOES rather
 *  than about what its docstring says. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

const fn = (src: string, name: string): string => {
  const at = src.indexOf(`export async function ${name}`);
  expect(at, `${name} should exist`).toBeGreaterThan(-1);
  const rest = src.slice(at + 10);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
};

describe('the vocabularies match the schema', () => {
  it('declares the four scenario kinds that replaced three tables', () => {
    expect([...SCENARIO_KINDS]).toEqual(['break_even', 'forecast', 'what_if', 'validation']);
    expect(isScenarioKind('what_if')).toBe(true);
    expect(isScenarioKind('whatif')).toBe(false);
  });

  it('declares the three assumption roles', () => {
    expect([...ASSUMPTION_ROLES]).toEqual(['given', 'derived', 'sensitivity']);
    expect(isAssumptionRole('sensitivity')).toBe(true);
    expect(isAssumptionRole('uncertain')).toBe(false);
  });

  it('declares the risk bands and outcomes', () => {
    expect([...RISK_BANDS]).toEqual(['low', 'medium', 'high', 'critical']);
    expect([...OUTCOMES]).toEqual(['churned', 'retained']);
    expect(isOutcome('churned')).toBe(true);
    expect(isOutcome('cancelled')).toBe(false);
  });
});

describe('the Claim-to-Proof position is stated, not implied', () => {
  it('reports every number as declared rather than computed from a ledger', () => {
    expect(SCENARIO_PROVENANCE).toBe('declared');
    expect(scenarioProvenance().basis).toBe('declared');
  });

  it('says so in words a surface can render', () => {
    expect(scenarioProvenance().note).toContain('No accounting adapter has run against live production data');
    expect(scenarioProvenance().note).toContain('nothing here is computed from your ledger');
  });

  it('attaches provenance to every scenario read', () => {
    expect(fn(scenarios, 'scenarioDetail')).toContain('provenance: SCENARIO_PROVENANCE');
    expect(fn(scenarios, 'compareScenarios')).toContain('provenance: SCENARIO_PROVENANCE');
    expect(fn(scenarios, 'roiFor')).toContain('provenance: SCENARIO_PROVENANCE');
  });

  it('exposes it as its own route, so a surface cannot omit it by accident', () => {
    expect(routes).toContain("router.get('/provenance'");
  });
});

describe('the baseline is exclusive', () => {
  it('clears and sets in one transaction', () => {
    const body = fn(scenarios, 'setBaseline');
    expect(body).toContain('db.transaction');
    expect(body).toContain('.set({ isBaseline: false');
    expect(body).toContain('.set({ isBaseline: true');
  });
});

describe('comparison reports what changed, not two columns of numbers', () => {
  const body = fn(scenarios, 'compareScenarios');

  it('returns a per-key delta', () => {
    expect(body).toContain('delta:');
  });

  it('distinguishes an absent assumption from one set to zero', () => {
    expect(body).toContain('present');
    // null, never 0 — "not stated" and "stated as no change" are different claims.
    expect(body).toContain(': null,');
  });
});

describe('break-even arithmetic is visible and honest', () => {
  const body = fn(scenarios, 'computeBreakEven');

  it('refuses a scenario that cannot break even at any volume', () => {
    expect(body).toContain('never breaks even at any volume');
  });

  it('leaves break-even null when it does not happen inside the horizon', () => {
    expect(body).toContain('breakEvenAt: breakEvenMonth === null ? null :');
  });

  it('computes contribution margin rather than delegating to a model', () => {
    expect(body).toContain('const contribution = pricePerUnit - variablePerUnit');
    expect(body).not.toContain('llm');
  });
});

describe('a Monte Carlo run is reproducible', () => {
  const body = fn(scenarios, 'runMonteCarlo');

  it('uses a seeded generator, never Math.random', () => {
    expect(body).toContain('Math.imul(1664525, state)');
    // Checked against the CODE, not the prose: the docstring names Math.random()
    // precisely to say why it is not used.
    expect(stripComments(scenarios)).not.toContain('Math.random');
  });

  it('stores the seed and the iteration count with the result', () => {
    expect(body).toContain('seed,');
    expect(body).toContain('iterations,');
  });

  it('refuses to run when nothing is marked sensitivity', () => {
    expect(body).toContain('nothing to vary');
  });

  it('varies only sensitivity assumptions and holds the rest fixed', () => {
    expect(body).toContain("a.role !== 'sensitivity'");
  });
});

describe('payback and ROI keep their nulls', () => {
  it('returns null payback rather than a sentinel when it never pays back', () => {
    expect(fn(scenarios, 'stampPayback')).toContain('monthlyReturn !== null && monthlyReturn > 0 ? investment / monthlyReturn : null');
  });

  it('stores the running cumulative rather than summing on every read', () => {
    expect(fn(scenarios, 'recordRoiPeriod')).toContain('cumulative: String(running)');
  });
});

describe('saved calculations do not become an execution sink', () => {
  it('stores the formula without evaluating it', () => {
    const body = fn(scenarios, 'saveCalculation');
    expect(body).toContain('formula: input.formula');
    for (const sink of ['eval(', 'new Function', 'vm.runIn']) expect(scenarios).not.toContain(sink);
  });
});

describe('churn predictions are falsifiable', () => {
  it('maps probability to a band in exactly one place', () => {
    expect(bandFor(0.9)).toBe('critical');
    expect(bandFor(0.6)).toBe('high');
    expect(bandFor(0.3)).toBe('medium');
    expect(bandFor(0.1)).toBe('low');
    // The writer derives the band; the caller never supplies one.
    expect(fn(churn, 'predict')).toContain('band: bandFor(input.probability)');
  });

  it('requires a model, because a score with no provenance is an assertion', () => {
    expect(fn(churn, 'predict')).toContain('model is required');
  });

  it('appends rather than updating, so an acted-on score survives', () => {
    const body = fn(churn, 'predict');
    expect(body).toContain('.insert(churnPredictions)');
    expect(body).not.toContain('onConflictDoUpdate');
  });

  it('scores every open prediction and leaves resolved ones alone', () => {
    const body = fn(churn, 'recordOutcome');
    expect(body).toContain('isNull(churnPredictions.outcome)');
  });

  it('calibrates on resolved predictions only', () => {
    const body = fn(churn, 'modelCalibration');
    expect(body).toContain('outcome} is not null');
    expect(body).toContain('actualChurnRate');
    expect(body).toContain('avgProbability');
  });

  it('groups calibration by model AND band', () => {
    expect(fn(churn, 'modelCalibration')).toContain('groupBy(churnPredictions.model, churnPredictions.band)');
  });

  it('logs only the bands somebody acts on', () => {
    expect(fn(churn, 'predict')).toContain("row.band === 'high' || row.band === 'critical'");
  });
});

describe('routing order keeps the literal segments reachable', () => {
  it('registers provenance, compare, churn, calculations and roi before /:id', () => {
    const idAt = routes.indexOf("router.get('/:id'");
    for (const literal of ["router.get('/provenance'", "router.get('/compare'", "router.get('/churn/risk'", "router.get('/calculations'", "router.get('/roi/:kind/:ref'"]) {
      expect(routes.indexOf(literal), literal).toBeLessThan(idAt);
    }
  });

  it('registers the two literal churn paths before /churn/:accountRef', () => {
    const param = routes.indexOf("router.get('/churn/:accountRef'");
    expect(routes.indexOf("router.get('/churn/risk'")).toBeLessThan(param);
    expect(routes.indexOf("router.get('/churn/calibration'")).toBeLessThan(param);
  });
});

describe('the merge added no schema', () => {
  it('touches only tables that already existed', () => {
    for (const t of ['breakEvenScenarios', 'scenarioAssumptions', 'monteCarloSimulations', 'paybackPeriod', 'roiTimelineEntries', 'savedCalculations']) {
      expect(scenarios).toContain(t);
    }
    expect(churn).toContain('churnPredictions');
  });

  it('gives every error a status the route returns', () => {
    expect(new ScenarioError('x').status).toBe(400);
    expect(new ScenarioError('x', 409).status).toBe(409);
  });
});
