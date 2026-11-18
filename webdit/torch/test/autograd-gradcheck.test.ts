import { describe, it } from "vitest";
import { OP_CASES } from "./helpers/op-cases";
import { caseData, expectClose, objective, runCase } from "./helpers/run-case";

/**
 * Every grad rule against central finite differences on the CPU reference
 * backend. The objective is Σ(out · w) for a fixed w, so every output element
 * contributes a distinct weight to every input gradient.
 */

const EPS = 1e-2;
const ATOL = 2e-2;
const RTOL = 2e-2;

describe("autograd gradient checks (CPU, finite differences)", () => {
  OP_CASES.forEach((c, index) => {
    it(c.name, async () => {
      const data = caseData(c, index);
      const analytic = await runCase(c, data);
      for (let i = 0; i < c.inputs.length; i++) {
        if (c.inputs[i]!.int) continue;
        const numeric = new Float64Array(data[i]!.length);
        for (let j = 0; j < numeric.length; j++) {
          const plus = data.map((d) => [...d]);
          const minus = data.map((d) => [...d]);
          plus[i]![j]! += EPS;
          minus[i]![j]! -= EPS;
          numeric[j] = ((await objective(c, plus)) - (await objective(c, minus))) / (2 * EPS);
        }
        const grad = analytic.grads[i];
        if (!grad) throw new Error(`${c.name}: input ${i} received no gradient`);
        // Non-vacuity: a rule (or forward) that silently yields zeros would
        // otherwise match a zero finite difference.
        if (!grad.some((g) => Math.abs(g) > 1e-4)) throw new Error(`${c.name}: input ${i} gradient is all zero`);
        expectClose(grad, numeric, ATOL, RTOL, `${c.name} d/dinput${i}`);
      }
    });
  });
});
