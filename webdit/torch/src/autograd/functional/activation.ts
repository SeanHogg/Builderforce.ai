import { UnsupportedOpError } from "../../backend/backend";
import type { DeviceTensor } from "../device-tensor";
import { backendOf, record } from "../record";

/** Pointwise activations and the last-dim softmax family, with grad rules. */

export function relu(x: DeviceTensor): DeviceTensor {
  const be = backendOf("relu", x);
  return record("relu", be.unary("relu", x.handle), [x], (gy) => [be.binary("relu_backward", x.handle, gy)]);
}

/** Tanh-approximated GELU (PyTorch `approximate="tanh"`). */
export function gelu(x: DeviceTensor): DeviceTensor {
  const be = backendOf("gelu", x);
  return record("gelu", be.unary("gelu", x.handle), [x], (gy) => [be.binary("gelu_backward", x.handle, gy)]);
}

export function exp(x: DeviceTensor): DeviceTensor {
  const be = backendOf("exp", x);
  const out = be.unary("exp", x.handle);
  const y = be.reshape(out, x.shape);
  return record("exp", out, [x], (gy) => [be.binary("mul", gy, y)], [y]);
}

export function log(x: DeviceTensor): DeviceTensor {
  const be = backendOf("log", x);
  return record("log", be.unary("log", x.handle), [x], (gy) => [be.binary("div", gy, x.handle)]);
}

function lastAxis(op: string, x: DeviceTensor, dim: number): void {
  const d = dim < 0 ? dim + x.ndim : dim;
  if (d !== x.ndim - 1) {
    throw new UnsupportedOpError(op, `only the last dim is supported (got dim=${dim} for a ${x.ndim}D tensor); transpose first`);
  }
}

export function softmax(x: DeviceTensor, dim = -1): DeviceTensor {
  lastAxis("softmax", x, dim);
  const be = backendOf("softmax", x);
  const out = be.softmax(x.handle);
  const y = be.reshape(out, x.shape);
  return record("softmax", out, [x], (gy) => [be.softmaxBackward(y, gy)], [y]);
}

export function logSoftmax(x: DeviceTensor, dim = -1): DeviceTensor {
  lastAxis("log_softmax", x, dim);
  const be = backendOf("log_softmax", x);
  const out = be.logSoftmax(x.handle);
  const y = be.reshape(out, x.shape);
  return record("log_softmax", out, [x], (gy) => [be.logSoftmaxBackward(y, gy)], [y]);
}
