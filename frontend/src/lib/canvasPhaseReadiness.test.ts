import { describe, expect, it } from 'vitest';
import { CANVAS_PHASES, type CanvasPhase } from './canvasPhases';
import {
  frontierPhase,
  phaseReadiness,
  readinessByPhase,
  readinessSignals,
  type PhaseRequirementId,
  type ReadinessNode,
  type ReadinessSignals,
} from './canvasPhaseReadiness';
import { boardDeployments, isLiveDeployment } from './canvas/boardDeployments';

/**
 * Readiness is DERIVED from the board — these pin the two halves of that: the signals
 * read the board's own objects through the existing primitives, and each phase's
 * readiness is a pure function of the four signals.
 */

// ── board fixtures: the smallest object each signal's primitive accepts ─────────────
const idea = (stage = 'captured'): ReadinessNode => ({ id: `idea-${stage}`, data: { kind: 'idea', title: 'Dog walking for towers', stage } });
const app: ReadinessNode = { id: 'build-1', data: { kind: 'build', title: 'Local app', localAppKey: 'key-1', modality: 'designer' } };
const deployment = (url?: string, extra: Record<string, unknown> = {}): ReadinessNode => ({
  id: `deploy-${url ?? 'none'}`,
  data: { kind: 'deployment', title: 'Production', environmentName: 'production', ...(url !== undefined ? { url } : {}), ...extra },
});
const metric: ReadinessNode = {
  id: 'metric-1',
  data: { kind: 'metric', title: 'Signups', definition: { id: 'signups', name: 'Signups', aggregate: { op: 'count' } } },
};
const note: ReadinessNode = { id: 'note-1', data: { kind: 'note', title: 'Scribble' } };

const NONE: ReadinessSignals = { hasIdea: false, hasApp: false, isLive: false, hasMetric: false };

describe('readinessSignals — read off the board, never stored', () => {
  it('is all false for an empty board, and for a board of unrelated cards', () => {
    expect(readinessSignals([])).toEqual(NONE);
    expect(readinessSignals([note])).toEqual(NONE);
  });

  it('reads each signal from its own object', () => {
    expect(readinessSignals([idea()])).toEqual({ ...NONE, hasIdea: true });
    expect(readinessSignals([app])).toEqual({ ...NONE, hasApp: true });
    expect(readinessSignals([deployment('https://dogs.example')])).toEqual({ ...NONE, isLive: true });
    expect(readinessSignals([metric])).toEqual({ ...NONE, hasMetric: true });
    expect(readinessSignals([idea(), app, deployment('https://dogs.example'), metric, note]))
      .toEqual({ hasIdea: true, hasApp: true, isLive: true, hasMetric: true });
  });

  it('counts a runnable code page as an app, the way the App surface does', () => {
    const page: ReadinessNode = { id: 'c', data: { kind: 'code', title: 'index.html', path: 'index.html', content: '<h1>Hi</h1>' } };
    expect(readinessSignals([page]).hasApp).toBe(true);
  });

  it('does not count a deployment with no address as live — it is a plan, not a running thing', () => {
    expect(readinessSignals([deployment()]).isLive).toBe(false);
    expect(readinessSignals([deployment('')]).isLive).toBe(false);
    expect(readinessSignals([deployment('   ')]).isLive).toBe(false);
    expect(isLiveDeployment(deployment().data)).toBe(false);
    expect(isLiveDeployment(deployment('https://dogs.example').data)).toBe(true);
    // A url on some OTHER kind is not a deployment.
    expect(isLiveDeployment({ kind: 'website', url: 'https://dogs.example' })).toBe(false);
  });

  it('still counts an idea that has been parked — parked is a decision about an idea, not its absence', () => {
    expect(readinessSignals([idea('parked')]).hasIdea).toBe(true);
    expect(readinessSignals([idea('dropped')]).hasIdea).toBe(true);
    // An unknown stage normalises to `captured`, never to "no idea".
    expect(readinessSignals([idea('in progress')]).hasIdea).toBe(true);
  });
});

describe('boardDeployments — the one reader of deployment cards', () => {
  it('lists deployments newest first, undated ones last', () => {
    const nodes = [
      deployment('https://a.example', { deployedAt: '2026-09-01T00:00:00Z' }),
      { id: 'undated', data: { kind: 'deployment', title: 'Staging', url: 'https://s.example' } },
      { id: 'newer', data: { kind: 'deployment', title: 'Prod v2', url: 'https://b.example', deployedAt: '2026-10-01T00:00:00Z' } },
      note,
    ];
    expect(boardDeployments(nodes).map((entry) => entry.id)).toEqual(['newer', 'deploy-https://a.example', 'undated']);
  });
});

/**
 * THE TABLE. Every phase × every combination of the four signals, against the rule as
 * the PRD states it — cumulative required requirements, Reach recommending a metric,
 * and "done" meaning the phase's OWN output exists. Written out independently of the
 * implementation's tables so a changed row there fails here.
 */
const REQUIRED: Record<CanvasPhase, PhaseRequirementId[]> = {
  idea: [],
  make: ['idea'],
  run: ['idea', 'app'],
  measure: ['idea', 'app', 'live'],
  reach: ['idea', 'app', 'live'],
};
const RECOMMENDED: Record<CanvasPhase, PhaseRequirementId[]> = { idea: [], make: [], run: [], measure: [], reach: ['metric'] };
const OUTPUT: Record<CanvasPhase, PhaseRequirementId | null> = { idea: 'idea', make: 'app', run: 'live', measure: 'metric', reach: null };
const SATISFIED_IN: Record<PhaseRequirementId, CanvasPhase> = { idea: 'idea', app: 'make', live: 'run', metric: 'measure' };
const SIGNAL: Record<PhaseRequirementId, keyof ReadinessSignals> = { idea: 'hasIdea', app: 'hasApp', live: 'isLive', metric: 'hasMetric' };

const COMBINATIONS: ReadinessSignals[] = Array.from({ length: 16 }, (_, bits) => ({
  hasIdea: Boolean(bits & 1),
  hasApp: Boolean(bits & 2),
  isLive: Boolean(bits & 4),
  hasMetric: Boolean(bits & 8),
}));
const label = (signals: ReadinessSignals) => Object.entries(signals).filter(([, on]) => on).map(([key]) => key).join('+') || 'empty';

describe('phaseReadiness — phase × signal table', () => {
  for (const phase of CANVAS_PHASES) {
    it.each(COMBINATIONS.map((signals) => [label(signals), signals] as const))(`${phase} with %s`, (_name, signals) => {
      const result = phaseReadiness(phase, signals);
      const missing = REQUIRED[phase].filter((id) => !signals[SIGNAL[id]]);
      const advisories = RECOMMENDED[phase].filter((id) => !signals[SIGNAL[id]]);
      const output = OUTPUT[phase];

      expect(result.phase).toBe(phase);
      expect(result.ready).toBe(missing.length === 0);
      // In arc order, each pointing at where it is satisfied.
      expect(result.missing).toEqual(missing.map((id) => ({ id, satisfiedIn: SATISFIED_IN[id], met: false })));
      expect(result.advisories).toEqual(advisories.map((id) => ({ id, satisfiedIn: SATISFIED_IN[id], met: false })));
      expect(result.done).toBe(output ? signals[SIGNAL[output]] : false);
    });
  }

  it('readinessByPhase is phaseReadiness for every phase', () => {
    for (const signals of COMBINATIONS) {
      const byPhase = readinessByPhase(signals);
      expect(Object.keys(byPhase)).toEqual([...CANVAS_PHASES]);
      for (const phase of CANVAS_PHASES) expect(byPhase[phase]).toEqual(phaseReadiness(phase, signals));
    }
  });
});

describe('the named cases', () => {
  it('Idea is always ready — there is nothing to need before an idea', () => {
    expect(phaseReadiness('idea', NONE)).toMatchObject({ ready: true, missing: [], advisories: [], done: false });
  });

  it('Measure on a board with nothing live names "live" and sends the reader to Run', () => {
    const result = phaseReadiness('measure', { ...NONE, hasIdea: true, hasApp: true });
    expect(result.ready).toBe(false);
    expect(result.missing.map((entry) => [entry.id, entry.satisfiedIn])).toEqual([['live', 'run']]);
  });

  it('Reach with everything but a metric is READY, with the metric as an advisory', () => {
    const result = phaseReadiness('reach', { hasIdea: true, hasApp: true, isLive: true, hasMetric: false });
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.advisories).toEqual([{ id: 'metric', satisfiedIn: 'measure', met: false }]);
  });

  it('Reach is never "done" in this version — its output is not a board fact yet', () => {
    expect(phaseReadiness('reach', { hasIdea: true, hasApp: true, isLive: true, hasMetric: true })).toMatchObject({ ready: true, advisories: [], done: false });
  });

  it('marks each phase done exactly when its own output exists', () => {
    expect(phaseReadiness('idea', { ...NONE, hasIdea: true }).done).toBe(true);
    expect(phaseReadiness('make', { ...NONE, hasApp: true }).done).toBe(true);
    expect(phaseReadiness('run', { ...NONE, isLive: true }).done).toBe(true);
    expect(phaseReadiness('measure', { ...NONE, hasMetric: true }).done).toBe(true);
    // Done and ready are different questions: an app with no idea is done-but-unready Make.
    expect(phaseReadiness('make', { ...NONE, hasApp: true }).ready).toBe(false);
  });
});

describe('frontierPhase — where a canvas with no remembered phase opens', () => {
  it.each([
    ['an empty board', NONE, 'idea'],
    ['an idea', { ...NONE, hasIdea: true }, 'make'],
    ['an idea and an app', { ...NONE, hasIdea: true, hasApp: true }, 'run'],
    ['an idea, an app and a live deployment', { ...NONE, hasIdea: true, hasApp: true, isLive: true }, 'measure'],
    ['everything through Measure', { hasIdea: true, hasApp: true, isLive: true, hasMetric: true }, 'reach'],
    // The FIRST phase whose output is missing, even when a later one is done.
    ['an app but no idea', { ...NONE, hasApp: true }, 'idea'],
    ['an idea and a metric, nothing built', { ...NONE, hasIdea: true, hasMetric: true }, 'make'],
  ] as const)('opens %s in %s', (_name, signals, expected) => {
    expect(frontierPhase(signals)).toBe(expected);
  });

  it('reads a real board the same way', () => {
    expect(frontierPhase(readinessSignals([]))).toBe('idea');
    expect(frontierPhase(readinessSignals([idea(), app]))).toBe('run');
    // A deployment with no url is not live, so the board is still in Run.
    expect(frontierPhase(readinessSignals([idea(), app, deployment()]))).toBe('run');
    expect(frontierPhase(readinessSignals([idea(), app, deployment('https://dogs.example')]))).toBe('measure');
  });
});
