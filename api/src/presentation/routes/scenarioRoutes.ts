/**
 * Scenario modelling, ROI and churn — the CFO's forward-looking surface
 * (PRD 19 §9).
 *
 *   GET    /api/scenarios                         list, baseline first        member
 *   POST   /api/scenarios                         create a draft              MANAGER
 *   GET    /api/scenarios/provenance              what these numbers rest on  member
 *   GET    /api/scenarios/compare?ids=1,2         per-assumption delta        member
 *   GET    /api/scenarios/:id                     scenario + assumptions + runs
 *   POST   /api/scenarios/:id/baseline            make it the baseline        MANAGER
 *   PUT    /api/scenarios/:id/assumptions/:key    set one assumption          MANAGER
 *   DELETE /api/scenarios/:id/assumptions/:key    remove one                  MANAGER
 *   POST   /api/scenarios/:id/compute             project and find break-even MANAGER
 *   POST   /api/scenarios/:id/simulate            seeded Monte Carlo          MANAGER
 *
 *   GET    /api/scenarios/roi/:kind/:ref          timeline + payback          member
 *   POST   /api/scenarios/roi/:kind/:ref          append a period             MANAGER
 *   PUT    /api/scenarios/roi/:kind/:ref/payback  stamp payback               MANAGER
 *
 *   GET    /api/scenarios/calculations            saved calculations          member
 *   POST   /api/scenarios/calculations            save one                    member
 *   DELETE /api/scenarios/calculations/:id        remove one                  member
 *
 *   GET    /api/scenarios/churn/risk              the retention queue         member
 *   GET    /api/scenarios/churn/calibration       was the model right         member
 *   GET    /api/scenarios/churn/:accountRef       one account's score history member
 *   POST   /api/scenarios/churn                   record a score              MANAGER
 *   POST   /api/scenarios/churn/:accountRef/outcome  close the loop           MANAGER
 *
 * MANAGER on every write that asserts a number about the business; MEMBER on the
 * reads and on saved calculations, which are a scratchpad rather than a claim.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import {
  ScenarioError,
  compareScenarios,
  computeBreakEven,
  createScenario,
  deleteAssumption,
  deleteCalculation,
  listCalculations,
  listScenarios,
  recordRoiPeriod,
  roiFor,
  runMonteCarlo,
  saveCalculation,
  scenarioDetail,
  scenarioProvenance,
  setAssumption,
  setBaseline,
  stampPayback,
  type AssumptionRole,
  type ScenarioKind,
} from '../../application/finance/scenarioModelling';
import {
  ChurnError,
  currentRisk,
  modelCalibration,
  predict,
  recordOutcome,
  riskHistory,
  type Outcome,
  type RiskBand,
} from '../../application/finance/churnPrediction';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ScenarioError || error instanceof ChurnError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};

const rowId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw new ScenarioError('That is not an id.', 400);
  return Math.floor(id);
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function createScenarioRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const manager = requireRole(TenantRole.MANAGER);
  const tenant = (c: { get: (k: string) => unknown }) => c.get('tenantId') as number;
  const who = async (c: Parameters<typeof resolveActorFromContext>[2] & { env: unknown }) =>
    resolveActorFromContext(c.env as Env, db, c);

  // Literal segments first — `provenance`, `compare`, `roi`, `calculations` and
  // `churn` would all be swallowed by `/:id` in registration order otherwise.

  router.get('/provenance', (c) => handle(async () => Response.json(scenarioProvenance())));

  router.get('/compare', (c) => handle(async () => {
    const ids = (c.req.query('ids') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    return Response.json(await compareScenarios(db, tenant(c), ids));
  }));

  // ── Churn ─────────────────────────────────────────────────────────────────

  router.get('/churn/risk', (c) => handle(async () => {
    const band = c.req.query('band');
    return Response.json({
      accounts: await currentRisk(db, tenant(c), band ? (band as RiskBand) : undefined),
    });
  }));

  router.get('/churn/calibration', (c) => handle(async () =>
    Response.json({ calibration: await modelCalibration(db, tenant(c)) })));

  router.post('/churn', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await predict(db, c.env as Env, tenant(c), await who(c), {
      accountRef: String(body.accountRef ?? ''),
      probability: num(body.probability) ?? Number.NaN,
      model: String(body.model ?? ''),
      drivers: body.drivers,
      ...(num(body.horizonDays) !== undefined ? { horizonDays: num(body.horizonDays) as number } : {}),
    }), { status: 201 });
  }));

  router.post('/churn/:accountRef/outcome', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await recordOutcome(
      db, c.env as Env, tenant(c), await who(c),
      c.req.param('accountRef'), String(body.outcome ?? '') as Outcome,
    ));
  }));

  router.get('/churn/:accountRef', (c) => handle(async () =>
    Response.json({ history: await riskHistory(db, tenant(c), c.req.param('accountRef')) })));

  // ── Saved calculations ────────────────────────────────────────────────────

  router.get('/calculations', (c) => handle(async () => {
    const ownerRef = c.req.query('ownerRef');
    return Response.json({ calculations: await listCalculations(db, tenant(c), ownerRef) });
  }));

  router.post('/calculations', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await saveCalculation(db, tenant(c), {
      name: String(body.name ?? ''),
      formula: String(body.formula ?? ''),
      inputs: body.inputs,
      result: num(body.result) ?? null,
      unit: str(body.unit) ?? null,
      ownerRef: str(body.ownerRef) ?? (c.get('userId') as string | undefined) ?? null,
    }), { status: 201 });
  }));

  router.delete('/calculations/:id', (c) => handle(async () =>
    Response.json(await deleteCalculation(db, tenant(c), rowId(c.req.param('id'))))));

  // ── ROI ───────────────────────────────────────────────────────────────────

  router.get('/roi/:kind/:ref', (c) => handle(async () =>
    Response.json(await roiFor(db, tenant(c), { kind: c.req.param('kind'), ref: c.req.param('ref') }))));

  router.post('/roi/:kind/:ref', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const periodAt = new Date(String(body.periodAt ?? ''));
    if (Number.isNaN(periodAt.getTime())) throw new ScenarioError('periodAt must be a date', 400);
    return Response.json(await recordRoiPeriod(
      db, tenant(c), { kind: c.req.param('kind'), ref: c.req.param('ref') },
      periodAt, num(body.cost) ?? 0, num(body.benefit) ?? 0,
      str(body.currency) ?? 'USD', str(body.note) ?? null,
    ), { status: 201 });
  }));

  router.put('/roi/:kind/:ref/payback', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    const investment = num(body.investment);
    if (investment === undefined) throw new ScenarioError('investment is required', 400);
    return Response.json(await stampPayback(
      db, tenant(c), { kind: c.req.param('kind'), ref: c.req.param('ref') },
      investment, num(body.monthlyReturn) ?? null, str(body.currency) ?? 'USD',
    ));
  }));

  // ── Scenarios ─────────────────────────────────────────────────────────────

  router.get('/', (c) => handle(async () => {
    const kind = c.req.query('kind');
    return Response.json({ scenarios: await listScenarios(db, tenant(c), kind ? (kind as ScenarioKind) : undefined) });
  }));

  router.post('/', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await createScenario(db, c.env as Env, tenant(c), await who(c), {
      name: String(body.name ?? ''),
      ...(str(body.kind) !== undefined ? { kind: str(body.kind) as ScenarioKind } : {}),
      description: str(body.description) ?? null,
      ...(num(body.horizonMonths) !== undefined ? { horizonMonths: num(body.horizonMonths) as number } : {}),
    }), { status: 201 });
  }));

  router.get('/:id', (c) => handle(async () =>
    Response.json(await scenarioDetail(db, tenant(c), rowId(c.req.param('id'))))));

  router.post('/:id/baseline', manager, (c) => handle(async () =>
    Response.json(await setBaseline(db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id'))))));

  router.put('/:id/assumptions/:key', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>();
    return Response.json(await setAssumption(db, tenant(c), rowId(c.req.param('id')), {
      key: c.req.param('key'),
      label: str(body.label) ?? null,
      value: num(body.value) ?? null,
      unit: str(body.unit) ?? null,
      ...(str(body.role) !== undefined ? { role: str(body.role) as AssumptionRole } : {}),
      minValue: num(body.minValue) ?? null,
      maxValue: num(body.maxValue) ?? null,
      note: str(body.note) ?? null,
    }));
  }));

  router.delete('/:id/assumptions/:key', manager, (c) => handle(async () =>
    Response.json(await deleteAssumption(db, tenant(c), rowId(c.req.param('id')), c.req.param('key')))));

  router.post('/:id/compute', manager, (c) => handle(async () =>
    Response.json(await computeBreakEven(db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id'))))));

  router.post('/:id/simulate', manager, (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    return Response.json(await runMonteCarlo(
      db, c.env as Env, tenant(c), await who(c), rowId(c.req.param('id')),
      {
        ...(num(body.iterations) !== undefined ? { iterations: num(body.iterations) as number } : {}),
        ...(num(body.seed) !== undefined ? { seed: num(body.seed) as number } : {}),
      },
    ));
  }));

  return router;
}
