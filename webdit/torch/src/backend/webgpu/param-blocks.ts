import { broadcastShape, broadcastStrides, contiguousStrides, productOf, type Shape } from "../../shape";
import { UnsupportedOpError } from "../backend";
import { reducePlan } from "../shape-rules";
import { MAX_RANK } from "./kernels/common";
import { BINARY_LAYOUT, BINARY_PARAMS } from "./kernels/elementwise";
import { COPY_LAYOUT, COPY_PARAMS, SUM_LAYOUT, SUM_PARAMS } from "./kernels/layout";

/**
 * Builders for the index-walking kernels' parameter blocks. Each returns the
 * block plus the output shape, so the backend never re-derives either.
 */

const bits = new Float32Array(1);
const bitsU = new Uint32Array(bits.buffer);
/** A float as the u32 the kernels `bitcast<f32>` back. */
export function floatBits(x: number): number {
  bits[0] = x;
  return bitsU[0]!;
}

function checkRank(rank: number, op: string): void {
  if (rank > MAX_RANK) throw new UnsupportedOpError(op, `rank ${rank} exceeds the WebGPU kernel limit of ${MAX_RANK}`);
}

export function binaryParams(a: Shape, b: Shape, op: string): { params: Uint32Array; outShape: number[] } {
  const outShape = broadcastShape(a, b);
  checkRank(outShape.length, op);
  const aS = broadcastStrides(a, outShape, contiguousStrides(a));
  const bS = broadcastStrides(b, outShape, contiguousStrides(b));
  const p = new Uint32Array(BINARY_PARAMS);
  p[0] = productOf(outShape);
  p[1] = outShape.length;
  p.set(outShape, BINARY_LAYOUT.shape);
  p.set(aS, BINARY_LAYOUT.aStrides);
  p.set(bS, BINARY_LAYOUT.bStrides);
  return { params: p, outShape };
}

export function copyParams(shape: Shape, strides: Shape, offset: number): Uint32Array {
  checkRank(shape.length, "strided_copy");
  const p = new Uint32Array(COPY_PARAMS);
  p[0] = productOf(shape);
  p[1] = shape.length;
  p[2] = offset;
  p.set(shape, COPY_LAYOUT.shape);
  p.set(strides, COPY_LAYOUT.strides);
  return p;
}

export function sumParams(shape: Shape, axes: ReadonlyArray<number>, keepDims: boolean): { params: Uint32Array; outShape: number[] } {
  checkRank(shape.length, "sum");
  const plan = reducePlan(shape, axes, keepDims);
  const strides = contiguousStrides(shape);
  const kept: number[] = [];
  const keptStrides: number[] = [];
  const red: number[] = [];
  const redStrides: number[] = [];
  for (let i = 0; i < shape.length; i++) {
    if (plan.axes.includes(i)) {
      red.push(shape[i]!);
      redStrides.push(strides[i]!);
    } else {
      kept.push(shape[i]!);
      keptStrides.push(strides[i]!);
    }
  }
  const p = new Uint32Array(SUM_PARAMS);
  p[0] = productOf(kept);
  p[1] = kept.length;
  p[2] = red.length;
  p[3] = productOf(red);
  p.set(kept, SUM_LAYOUT.keptShape);
  p.set(keptStrides, SUM_LAYOUT.keptStrides);
  p.set(red, SUM_LAYOUT.redShape);
  p.set(redStrides, SUM_LAYOUT.redStrides);
  return { params: p, outShape: plan.outShape };
}
