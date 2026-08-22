import Bars from './Bars';
import Compare from './Compare';
import Devices from './Devices';
import Flow from './Flow';
import Launch from './Launch';
import Matrix from './Matrix';
import Screen from './Screen';
import Stack from './Stack';
import Templates from './Templates';
import type { FigureSpec } from './types';

/**
 * Kind → renderer. The one place a figure kind is registered.
 *
 * A registry rather than a switch inside the dispatcher, for the reason every
 * other registry in this codebase exists: adding the tenth kind must not mean
 * editing the component that draws the other nine. The `Record` is exhaustive
 * over the union, so declaring a kind in `types.ts` and forgetting to draw it
 * is a compile error rather than an article with a blank space in it.
 */
type Renderer<K extends FigureSpec['kind']> = (props: {
  spec: Extract<FigureSpec, { kind: K }>;
}) => React.ReactNode;

type FigureRegistry = { [K in FigureSpec['kind']]: Renderer<K> };

export const FIGURE_RENDERERS: FigureRegistry = {
  flow: Flow,
  matrix: Matrix,
  stack: Stack,
  bars: Bars,
  compare: Compare,
  screen: Screen,
  devices: Devices,
  templates: Templates,
  launch: Launch,
};

/** Draw a spec through its registered renderer. */
export function renderFigure(spec: FigureSpec): React.ReactNode {
  // The registry is keyed by the discriminant, so the lookup and the spec agree
  // by construction; the cast carries that fact past a generic Record index.
  const Renderer = FIGURE_RENDERERS[spec.kind] as Renderer<FigureSpec['kind']>;
  return <Renderer spec={spec} />;
}
