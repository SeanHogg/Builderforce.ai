export { Tensor, materialize } from "./tensor";
export type { DType, AnyTypedArray } from "./dtype";
export type { Shape } from "./shape";
export {
  zeros,
  ones,
  full,
  arange,
  fromArray,
  fromIntArray,
  randn,
  rand,
  eye,
  tensorOf,
} from "./creation";
export {
  contiguousStrides,
  productOf,
  shapesEqual,
  broadcastShape,
  broadcastStrides,
  normalizeAxis,
  normalizeAxes,
} from "./shape";
export * from "./ops";
export * as nn from "./nn";
/** Training engine (autograd, nn, optim) — also at `@webdit/torch/autograd`. */
export * as autograd from "./autograd";
