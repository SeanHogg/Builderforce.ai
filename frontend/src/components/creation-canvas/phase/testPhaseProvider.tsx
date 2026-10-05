/**
 * TEST-ONLY: render a tree inside a `CanvasPhaseProvider` built the way the canvas builds
 * it — readiness derived from a board's nodes (or from explicit signals) through the same
 * three pure functions `useCanvasPhaseReadiness` calls, never a hand-written readiness
 * object that could disagree with them.
 *
 * Every phase test (lens, ghost, path, stepper, starters, room stations, Operate, Launch)
 * mounts through here, so a change to the provider's props is fixed in one place.
 */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import type { CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import {
  frontierPhase,
  readinessByPhase,
  readinessSignals,
  type ReadinessNode,
  type ReadinessSignals,
} from '@/lib/canvasPhaseReadiness';
import type { CanvasPhaseReadinessState } from '../hooks/useCanvasPhaseReadiness';
import type { CreationObjectKind } from '../types';
import { CanvasPhaseProvider } from './CanvasPhaseContext';

export interface PhaseHarnessOptions {
  /** Defaults to the frontier of the given board — where a canvas with no stored choice opens. */
  phase?: CanvasPhase;
  /** The board the readiness is read from. Ignored when `signals` is given. */
  nodes?: readonly ReadinessNode[];
  signals?: Partial<ReadinessSignals>;
  setPhase?: (phase: CanvasPhase) => void;
  askBrain?: (prompt: string) => void;
  /** Pass `null` for a viewer who cannot edit. Defaults to a spy. */
  appendAtCenter?: ((kind: CreationObjectKind) => unknown) | null;
  openSurface?: (surface: CanvasSurfaceId) => void;
  renderOptions?: Omit<RenderOptions, 'wrapper'>;
}

/** Readiness exactly as `useCanvasPhaseReadiness` computes it, from nodes or signals. */
export function buildPhaseReadiness(options: Pick<PhaseHarnessOptions, 'nodes' | 'signals'> = {}): CanvasPhaseReadinessState {
  const signals: ReadinessSignals = options.signals
    ? { hasIdea: false, hasApp: false, isLive: false, hasMetric: false, ...options.signals }
    : readinessSignals(options.nodes ?? []);
  return { signals, byPhase: readinessByPhase(signals), frontier: frontierPhase(signals) };
}

/** Every signal on — a board with an idea, an app, a live deployment and a metric. */
export const ALL_SIGNALS: ReadinessSignals = { hasIdea: true, hasApp: true, isLive: true, hasMetric: true };

export function PhaseHarness({ children, ...options }: PhaseHarnessOptions & { children: ReactNode }) {
  const readiness = buildPhaseReadiness(options);
  return (
    <CanvasPhaseProvider
      phase={options.phase ?? readiness.frontier}
      setPhase={options.setPhase ?? (() => {})}
      readiness={readiness}
      askBrain={options.askBrain ?? (() => {})}
      appendAtCenter={options.appendAtCenter === undefined ? () => undefined : options.appendAtCenter}
      openSurface={options.openSurface ?? (() => {})}
    >
      {children}
    </CanvasPhaseProvider>
  );
}

/**
 * Render `ui` inside a phase provider. Returns the RTL result plus the spies the
 * provider was given (the caller's own, or fresh `vi.fn()`s) and the readiness built.
 */
export function renderWithPhase(ui: ReactElement, options: PhaseHarnessOptions = {}) {
  const setPhase = options.setPhase ?? vi.fn();
  const askBrain = options.askBrain ?? vi.fn();
  const appendAtCenter = options.appendAtCenter === undefined ? vi.fn() : options.appendAtCenter;
  const openSurface = options.openSurface ?? vi.fn();
  const readiness = buildPhaseReadiness(options);
  const harness = { ...options, setPhase, askBrain, appendAtCenter, openSurface };
  const result = render(<PhaseHarness {...harness}>{ui}</PhaseHarness>, options.renderOptions);
  return {
    ...result,
    setPhase,
    askBrain,
    appendAtCenter,
    openSurface,
    readiness,
    /** Re-render with different harness options, keeping the same spies unless overridden. */
    rerenderWithPhase: (next: ReactElement, nextOptions: PhaseHarnessOptions = {}) =>
      result.rerender(<PhaseHarness {...harness} {...nextOptions}>{next}</PhaseHarness>),
  };
}
