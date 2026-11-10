/**
 * Every async read in these tests goes through `findBy*` / `waitFor`, never a fixed sleep. Their
 * default wait is 1 s, which a loaded machine (the whole repo's suites run side by side) can
 * outlast on the idle-scheduled layouts and lazy chunks. One generous ceiling makes the suite
 * deterministic: a passing test still returns the moment its condition holds.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 15_000 });

// jsdom has no WebGL: the stage host draws every stage camera with the no-op renderer (PRD 43 B3, Tests), so the a11y
// proxies, captions, cards and picking mount and work. A test of the no-WebGL fallback provides its own factory through
// `StageFactoryContext`; the real factory's decline is tested with `vi.importActual`.
vi.mock('./src/stage/host/stageFactory', async () => {
    const { createNoopStage } = await import('./src/stage/renderer');
    return { createStage: () => createNoopStage() };
});

// jsdom has no ResizeObserver; the 3D view (react-three-fiber via react-use-measure) needs one.
if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverPolyfill {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverPolyfill;
}
