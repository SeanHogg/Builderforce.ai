import type { BackendTensor } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";
import { backendOf, record, releaseAll, sumTo } from "../record";

/** Broadcasting arithmetic with grad rules. */

export function add(a: DeviceTensor, b: DeviceTensor): DeviceTensor {
  const be = backendOf("add", a, b);
  return record("add", be.binary("add", a.handle, b.handle), [a, b], (gy, needs) => [
    needs[0] ? sumTo(be, gy, a.shape) : null,
    needs[1] ? sumTo(be, gy, b.shape) : null,
  ]);
}

export function sub(a: DeviceTensor, b: DeviceTensor): DeviceTensor {
  const be = backendOf("sub", a, b);
  return record("sub", be.binary("sub", a.handle, b.handle), [a, b], (gy, needs) => {
    let gb: BackendTensor | null = null;
    if (needs[1]) {
      const neg = be.affine(gy, -1, 0);
      gb = sumTo(be, neg, b.shape);
      be.release(neg);
    }
    return [needs[0] ? sumTo(be, gy, a.shape) : null, gb];
  });
}

export function mul(a: DeviceTensor, b: DeviceTensor): DeviceTensor {
  const be = backendOf("mul", a, b);
  return record("mul", be.binary("mul", a.handle, b.handle), [a, b], (gy, needs) => {
    const side = (other: DeviceTensor, shape: DeviceTensor["shape"]) => {
      const t = be.binary("mul", gy, other.handle);
      const g = sumTo(be, t, shape);
      be.release(t);
      return g;
    };
    return [needs[0] ? side(b, a.shape) : null, needs[1] ? side(a, b.shape) : null];
  });
}

export function div(a: DeviceTensor, b: DeviceTensor): DeviceTensor {
  const be = backendOf("div", a, b);
  return record("div", be.binary("div", a.handle, b.handle), [a, b], (gy, needs) => {
    let ga: BackendTensor | null = null;
    let gb: BackendTensor | null = null;
    if (needs[0]) {
      const t = be.binary("div", gy, b.handle);
      ga = sumTo(be, t, a.shape);
      be.release(t);
    }
    if (needs[1]) {
      // d(a/b)/db = -a / b²
      const num = be.binary("mul", gy, a.handle);
      const b2 = be.binary("mul", b.handle, b.handle);
      const q = be.binary("div", num, b2);
      const neg = be.affine(q, -1, 0);
      gb = sumTo(be, neg, b.shape);
      releaseAll(be, num, b2, q, neg);
    }
    return [ga, gb];
  });
}

/** `a * scale + shift` — scalar multiply / add / negate. */
export function affine(a: DeviceTensor, scale: number, shift = 0): DeviceTensor {
  const be = backendOf("affine", a);
  return record("affine", be.affine(a.handle, scale, shift), [a], (gy) => [be.affine(gy, scale, 0)]);
}

export const mulScalar = (a: DeviceTensor, s: number) => affine(a, s, 0);
export const addScalar = (a: DeviceTensor, s: number) => affine(a, 1, s);
export const neg = (a: DeviceTensor) => affine(a, -1, 0);
