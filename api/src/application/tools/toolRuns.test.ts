/**
 * A SAVED tool run, read by somebody who does not speak the saver's language.
 *
 * `tool_runs.result` is persisted JSON, so a snapshot taken by a German manager
 * used to read as German to an English teammate opening the same workspace
 * history — and vice versa. Three cases decide whether that is actually fixed,
 * and all three are here:
 *
 *   1. a `self` run whose stored rendering is in the WRONG language still reads
 *      in the reader's, because its `input` is enough to re-score from;
 *   2. a `data` run — whose telemetry window has passed and cannot be re-queried
 *      — renders its CHROME in the reader's language while its FIGURES stay the
 *      same measurement;
 *   3. a row written before any of this existed still renders, and never throws.
 */
import { describe, expect, it } from 'vitest';
import { ToolService } from './ToolService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { withFigures } from './storedToolResult';
import { getTool } from './toolDefinitions';
import type { QuestionnaireTool, ToolResult } from './toolTypes';

type Row = {
  id: string;
  toolId: string;
  kind: string;
  projectId: number | null;
  taskId: number | null;
  segmentId: string | null;
  tenantId: number;
  input: unknown;
  result: unknown;
  createdBy: string | null;
  createdAt: Date;
};

/**
 * The narrowest possible stand-in for the drizzle chain `listRuns` builds.
 *
 * A real database is not the subject here — the subject is what the reader gets
 * back for a row that is already in the table, so the row IS the fixture. Only
 * the five links the reader actually calls are implemented; anything else would
 * be a mock asserting its own shape.
 */
function dbWithRows(rows: Row[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

/** No KV binding, so the read-through cache falls straight through to the
 *  loader — the cache is exercised by its own tests, not by these. */
const env = {} as Env;

const row = (over: Partial<Row>): Row => ({
  id: 'run-1',
  toolId: 'agentic-maturity',
  kind: 'self',
  projectId: null,
  taskId: null,
  segmentId: null,
  tenantId: 1,
  input: {},
  result: {},
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const maturityAnswers = (): Record<string, number> => Object.fromEntries(
  (getTool('agentic-maturity') as QuestionnaireTool).sections
    .flatMap((s) => s.questions)
    .map((q) => [q.id, 3]),
);

describe('a saved SELF run', () => {
  const answers = maturityAnswers();

  /** What the old code path wrote: whatever language the saver was reading in. */
  const savedInGerman: ToolResult = {
    headline: 'Stufe 3 — Definiert',
    summary: undefined,
    score: 3,
    scoreLabel: 'Definiert',
    metrics: [{ key: 'delivery', label: 'Softwarelieferung', value: 'Stufe 3 — Definiert', tier: 3 }],
    recommendations: [{ title: 'Softwarelieferung — auf Stufe 4', detail: '…' }],
  };

  it('reads in ENGLISH for an English reader, whatever language it was stored in', async () => {
    const service = new ToolService(dbWithRows([row({ input: answers, result: savedInGerman })]));
    const [run] = await service.listRuns(env, 1, 'agentic-maturity', null, 'en');

    expect(run!.result.headline).toContain('Level 3');
    expect(run!.result.headline).not.toContain('Stufe');
    expect(run!.result.scoreLabel).toBe('Defined');
  });

  it('reads in FRENCH for a French reader, from the same row', async () => {
    const service = new ToolService(dbWithRows([row({ input: answers, result: savedInGerman })]));
    const [run] = await service.listRuns(env, 1, 'agentic-maturity', null, 'fr');

    expect(run!.result.headline).toContain('Niveau 3');
    expect(run!.result.scoreLabel).toBe('Défini');
  });

  it('re-scores identically in every language — a lens on words, not on numbers', async () => {
    const service = new ToolService(dbWithRows([row({ input: answers, result: savedInGerman })]));
    const [en] = await service.listRuns(env, 1, 'agentic-maturity', null, 'en');
    const [de] = await service.listRuns(env, 1, 'agentic-maturity', null, 'de');

    expect(de!.result.score).toBe(en!.result.score);
    expect(de!.result.metrics.map((m) => m.key)).toEqual(en!.result.metrics.map((m) => m.key));
    expect(de!.result.metrics.map((m) => m.tier)).toEqual(en!.result.metrics.map((m) => m.tier));
  });

  it('keeps the stored rendering when the input can no longer be scored', async () => {
    // A tool that has since been retired. The run is still a fact about the
    // workspace, so it renders — as whatever it was, never as nothing.
    const service = new ToolService(dbWithRows([row({ toolId: 'a-tool-we-deleted', result: savedInGerman })]));
    const [run] = await service.listRuns(env, 1, 'a-tool-we-deleted', null, 'en');
    expect(run!.result.headline).toBe('Stufe 3 — Definiert');
  });
});

describe('a saved DATA run', () => {
  // The telemetry window this was taken over is long gone, so these figures are
  // the ONLY thing the chrome can be re-rendered from.
  const figures = {
    days: 90,
    totalDeployments: 42,
    deploymentFrequencyPerDay: 0.5,
    leadTimeHours: 30,
    changeFailureRatePct: 12,
    mttrHours: 4,
  };
  const stored = withFigures(
    {
      headline: 'High performer',
      summary: 'Scored from your real delivery data over the last 90 days — 42 deployments.',
      score: 4,
      scoreLabel: 'High',
      metrics: [{ label: 'Deployment frequency', value: '3.5/week', tier: 4 }],
      recommendations: [],
    },
    figures,
  );

  const dataRow = row({ toolId: 'dora-quickcheck', kind: 'data', input: { days: 90 }, result: stored });

  it('renders its CHROME in the reader’s language', async () => {
    const service = new ToolService(dbWithRows([dataRow]));
    const [en] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'en');
    const [de] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'de');

    expect(de!.result.metrics[0]!.label).not.toBe(en!.result.metrics[0]!.label);
    expect(de!.result.summary).not.toBe(en!.result.summary);
    expect(de!.result.summary).toBeTruthy();
  });

  it('leaves the FIGURES identical — the measurement is not translated', async () => {
    const service = new ToolService(dbWithRows([dataRow]));
    const [en] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'en');
    const [zh] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'zh');

    expect(zh!.result.score).toBe(en!.result.score);
    expect(zh!.result.metrics.map((m) => m.tier)).toEqual(en!.result.metrics.map((m) => m.tier));
    // …and the row itself is untouched: nothing was rewritten to serve a reader.
    expect((dataRow.result as { figures: unknown }).figures).toEqual(figures);
  });

  it('does not leak the envelope’s own properties into the DTO', async () => {
    // `v` and `figures` are storage, not result. A caller holding a `ToolResult`
    // must not find scoring internals hanging off it.
    const service = new ToolService(dbWithRows([dataRow]));
    const [run] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'en');
    expect(run!.result).not.toHaveProperty('v');
    expect(run!.result).not.toHaveProperty('figures');
  });
});

describe('a row written before the envelope existed', () => {
  it('still renders — no version, no figures, no throw', async () => {
    const legacy = row({
      toolId: 'dora-quickcheck',
      kind: 'data',
      input: { days: 90 },
      // Exactly the shape the old writer produced: a bare ToolResult.
      result: {
        headline: 'Elite performer',
        summary: 'Scored from your real delivery data over the last 90 days — 91 deployments.',
        score: 5,
        scoreLabel: 'Elite',
        metrics: [{ label: 'Deployment frequency', value: '9.1/week', tier: 5 }],
        recommendations: [],
      },
    });
    const service = new ToolService(dbWithRows([legacy]));

    for (const locale of ['en', 'de', 'zh'] as const) {
      const [run] = await service.listRuns(env, 1, 'dora-quickcheck', null, locale);
      // Nothing to re-render FROM, so it reads exactly as it was recorded. That
      // is the honest answer: it is a snapshot, not a live figure.
      expect(run!.result.headline).toBe('Elite performer');
      expect(run!.result.score).toBe(5);
    }
  });

  it('survives a result column that is not a result at all', async () => {
    // `jsonb` accepts anything, and one malformed row from a retired write path
    // must not 500 the whole history page.
    const service = new ToolService(dbWithRows([row({ toolId: 'dora-quickcheck', kind: 'data', result: 'not an object' })]));
    const [run] = await service.listRuns(env, 1, 'dora-quickcheck', null, 'fr');
    expect(run!.result.metrics).toEqual([]);
    expect(run!.result.recommendations).toEqual([]);
  });
});
