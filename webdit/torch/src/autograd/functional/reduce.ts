import { reducePlan } from "../../backend/shape-rules";
import { productOf } from "../../shape";
import type { DeviceTensor } from "../device-tensor";
import { backendOf, expandTo, record } from "../record";

/** Sum / mean over axes (all axes when none are given), with grad rules. */

function allAxes(x: DeviceTensor, axes?: number | number[]): number[] {
  if (axes === undefined) return x.shape.map((_, i) => i);
  return typeof axes === "number" ? [axes] : axes;
}

export function sum(x: DeviceTensor, axes?: number | number[], keepDims = false): DeviceTensor {
  const be = backendOf("sum", x);
  const plan = reducePlan(x.shape, allAxes(x, axes), keepDims);
  return record("sum", be.sum(x.handle, plan.axes, keepDims), [x], (gy) => [expandTo(be, gy, plan.keepShape, x.shape)]);
}

export function mean(x: DeviceTensor, axes?: number | number[], keepDims = false): DeviceTensor {
  const be = backendOf("mean", x);
  const plan = reducePlan(x.shape, allAxes(x, axes), keepDims);
  const count = productOf(plan.axes.map((a) => x.shape[a]!));
  const total = be.sum(x.handle, plan.axes, keepDims);
  const out = be.affine(total, 1 / count, 0);
  be.release(total);
  return record("mean", out, [x], (gy) => {
    const scaled = be.affine(gy, 1 / count, 0);
    const g = expandTo(be, scaled, plan.keepShape, x.shape);
    be.release(scaled);
    return [g];
  });
}
