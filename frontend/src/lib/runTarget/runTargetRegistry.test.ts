import { describe, expect, it, vi } from 'vitest';
import { chooseRunTarget, RUN_TARGET_ORDER, runTargetsFor, RunPlanLimitError, startRun } from './runTargetRegistry';
import { CANVAS_APP, HIRED_VIDEO } from './blueprintFixtures';
import { closedLogStream, type RunContext, type RunSession, type RunStart, type RunTarget } from './runTarget';
import { PlanLimitError } from '@/lib/planLimitError';

const context: RunContext = { projectId: '7', loadFiles: async () => ({ files: { 'package.json': '{}' }, unreadable: [] }) };

function fakeSession(targetId: RunSession['targetId']): RunSession {
  return {
    targetId,
    services: () => [],
    url: () => undefined,
    logs: () => closedLogStream(),
    restart: async () => undefined,
    stop: async () => undefined,
    onState: () => () => undefined,
  };
}

function fakeTarget(
  id: RunTarget['id'], accepts: boolean, start: () => Promise<RunStart>, startsOn: RunTarget['startsOn'] = 'attach',
): RunTarget {
  return {
    id,
    startsOn,
    accepts: () => (accepts ? { ok: true } : { ok: false, code: 'serviceDeclined', detail: `${id} says no` }),
    start: vi.fn(start),
  };
}

const planLimit = () => new PlanLimitError({ error: 'upgrade_required', upgradeRequired: true, currentPlan: 'free', requiredPlan: 'pro' });

describe('the order is data, chosen by context', () => {
  it('tries the container first for an execution, the browser first for a project panel', () => {
    expect(RUN_TARGET_ORDER).toEqual({ execution: ['container', 'browser'], project: ['browser', 'container'] });
    expect(runTargetsFor({ executionId: 12 }).map((t) => t.id)).toEqual(['container', 'browser']);
    expect(runTargetsFor({ executionId: null }).map((t) => t.id)).toEqual(['browser', 'container']);
  });
});

describe('chooseRunTarget', () => {
  const projectOrder = runTargetsFor({});

  it('runs a canvas app (Vite + Express + Postgres) in the browser', () => {
    const choice = chooseRunTarget(CANVAS_APP, projectOrder);
    expect(choice.target?.id).toBe('browser');
    expect(choice.declined).toEqual([]);
  });

  it('sends the hired.video shape to the container, with the browser decline reason', () => {
    const choice = chooseRunTarget(HIRED_VIDEO, projectOrder);
    expect(choice.target?.id).toBe('container');
    expect(choice.declined).toHaveLength(1);
    expect(choice.declined[0]).toMatchObject({ targetId: 'browser', code: 'serviceDeclined' });
    expect(choice.declined[0]?.detail).toMatch(/wrangler/i);
  });

  it('sends a project with no blueprint to the container, saying so', () => {
    const choice = chooseRunTarget(null, projectOrder);
    expect(choice.target?.id).toBe('container');
    expect(choice.declined).toEqual([{ targetId: 'browser', code: 'noBlueprint' }]);
  });
});

describe('startRun', () => {
  it('never starts a request-started target on open: it awaits the user’s Run', async () => {
    const browser = fakeTarget('browser', true, async () => ({ ok: true, session: fakeSession('browser') }), 'request');
    const container = fakeTarget('container', true, async () => ({ ok: true, session: fakeSession('container') }));
    const outcome = await startRun(CANVAS_APP, context, { targets: [browser, container] });
    expect(outcome).toEqual({ ok: false, declined: [], awaiting: 'browser' });
    expect(browser.start).not.toHaveBeenCalled();
    expect(container.start).not.toHaveBeenCalled();
    const requested = await startRun(CANVAS_APP, context, { targets: [browser, container], requested: true });
    expect(requested.ok && requested.session.targetId).toBe('browser');
  });

  it('attaches to a container on open', async () => {
    const container = fakeTarget('container', true, async () => ({ ok: true, session: fakeSession('container') }));
    const outcome = await startRun(null, context, { targets: [container] });
    expect(outcome.ok && outcome.session.targetId).toBe('container');
  });

  it('falls through when an accepting target cannot start, keeping why', async () => {
    const browser = fakeTarget('browser', true, async () => ({ ok: false, code: 'noFiles' }), 'request');
    const container = fakeTarget('container', true, async () => ({ ok: true, session: fakeSession('container') }));
    const outcome = await startRun(CANVAS_APP, context, { targets: [browser, container], requested: true });
    expect(outcome.ok && outcome.session.targetId).toBe('container');
    expect(outcome.declined).toEqual([{ targetId: 'browser', code: 'noFiles' }]);
  });

  it('turns a start that throws into a decline (runtimeUnavailable) and tries the next target', async () => {
    const browser = fakeTarget('browser', true, async () => { throw new Error('relay unreachable'); }, 'request');
    const container = fakeTarget('container', true, async () => ({ ok: true, session: fakeSession('container') }));
    const outcome = await startRun(CANVAS_APP, context, { targets: [browser, container], requested: true });
    expect(outcome.ok && outcome.session.targetId).toBe('container');
    expect(outcome.declined).toEqual([{ targetId: 'browser', code: 'runtimeUnavailable', detail: 'relay unreachable' }]);
  });

  it('reports every decline when no target runs the app', async () => {
    const browser = fakeTarget('browser', false, async () => ({ ok: true, session: fakeSession('browser') }), 'request');
    const container = fakeTarget('container', true, async () => ({ ok: false, code: 'noContainerPreview' }));
    const outcome = await startRun(HIRED_VIDEO, context, { targets: [browser, container] });
    expect(outcome.ok).toBe(false);
    expect(outcome.declined).toEqual([
      { targetId: 'browser', code: 'serviceDeclined', detail: 'browser says no' },
      { targetId: 'container', code: 'noContainerPreview' },
    ]);
  });

  it('rejects a plan limit with the declines collected before it', async () => {
    const browser = fakeTarget('browser', false, async () => ({ ok: true, session: fakeSession('browser') }), 'request');
    const container = fakeTarget('container', true, async () => { throw planLimit(); });
    const failure = await startRun(HIRED_VIDEO, context, { targets: [browser, container] }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RunPlanLimitError);
    expect((failure as RunPlanLimitError).declined).toEqual([{ targetId: 'browser', code: 'serviceDeclined', detail: 'browser says no' }]);
    expect((failure as RunPlanLimitError).limit).toBeInstanceOf(PlanLimitError);
  });

  it('keeps going past a plan limit when the free browser tier can run it (D7)', async () => {
    const container = fakeTarget('container', true, async () => { throw planLimit(); });
    const browser = fakeTarget('browser', true, async () => ({ ok: true, session: fakeSession('browser') }), 'request');
    const outcome = await startRun(CANVAS_APP, { ...context, executionId: 12 }, { targets: [container, browser] });
    expect(outcome).toMatchObject({ ok: false, awaiting: 'browser' });
    expect(outcome.planLimit).toBeInstanceOf(PlanLimitError);
  });
});
