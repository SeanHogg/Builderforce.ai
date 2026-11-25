/**
 * Retained command outputs (`output_filter`): each run reads only its own, the last
 * MAX_OUTPUTS_PER_RUN per run are kept, and a settled run's go with it.
 */

import { describe, expect, it } from "vitest";
import { forgetRunOutputs, MAX_OUTPUTS_PER_RUN, readOutput, retainOutput } from "./localShellOutputs";

describe("retained command outputs", () => {
  it("an output is read back by its id — by its own run only", () => {
    const id = retainOutput(7101, "full text");
    expect(readOutput(7101, id)).toBe("full text");
    expect(readOutput(7102, id)).toBeUndefined();
    forgetRunOutputs(7101);
  });

  it("keeps the last MAX_OUTPUTS_PER_RUN of a run; the oldest go first", () => {
    const ids = Array.from({ length: MAX_OUTPUTS_PER_RUN + 3 }, (_, i) => retainOutput(7111, `o${i}`));
    expect(readOutput(7111, ids[0]!)).toBeUndefined();
    expect(readOutput(7111, ids[2]!)).toBeUndefined();
    expect(readOutput(7111, ids[3]!)).toBe("o3");
    expect(readOutput(7111, ids[ids.length - 1]!)).toBe(`o${MAX_OUTPUTS_PER_RUN + 2}`);
    forgetRunOutputs(7111);
  });

  it("another run's outputs do not count against this run's", () => {
    const mine = retainOutput(7121, "mine");
    for (let i = 0; i < MAX_OUTPUTS_PER_RUN + 5; i += 1) retainOutput(7122, `theirs ${i}`);
    expect(readOutput(7121, mine)).toBe("mine");
    forgetRunOutputs(7121);
    forgetRunOutputs(7122);
  });

  it("a settled run's outputs are forgotten", () => {
    const id = retainOutput(7131, "x");
    forgetRunOutputs(7131);
    expect(readOutput(7131, id)).toBeUndefined();
  });
});
