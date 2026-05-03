import { describe, it, expect } from "vitest";
import { bfloat16ToFloat, floatToHalf, halfToFloat } from "../src/half";

describe("floatToHalf / halfToFloat", () => {
  it.each([
    0,
    1,
    -1,
    0.5,
    -0.25,
    65504, // max FP16
    -65504,
    1.5258789e-5, // min positive normal FP16
  ])("round-trips %s within FP16 precision", (val) => {
    const round = halfToFloat(floatToHalf(val));
    if (val === 0) expect(round).toBe(0);
    else expect(Math.abs(round - val) / Math.abs(val)).toBeLessThan(1e-3);
  });

  it("encodes +Inf and -Inf", () => {
    expect(halfToFloat(floatToHalf(Infinity))).toBe(Infinity);
    expect(halfToFloat(floatToHalf(-Infinity))).toBe(-Infinity);
  });

  it("clamps overflow to Inf with the right sign", () => {
    expect(halfToFloat(floatToHalf(1e30))).toBe(Infinity);
    expect(halfToFloat(floatToHalf(-1e30))).toBe(-Infinity);
  });

  it("flushes underflow to zero with the right sign", () => {
    expect(halfToFloat(floatToHalf(1e-30))).toBe(0);
    expect(Object.is(halfToFloat(floatToHalf(-1e-30)), -0)).toBe(true);
  });
});

describe("bfloat16ToFloat", () => {
  it("decodes BF16(0x3f80) as 1.0", () => {
    expect(bfloat16ToFloat(0x3f80)).toBe(1.0);
  });

  it("decodes BF16(0xbf80) as -1.0", () => {
    expect(bfloat16ToFloat(0xbf80)).toBe(-1.0);
  });

  it("decodes BF16(0x4040) as 3.0", () => {
    expect(bfloat16ToFloat(0x4040)).toBe(3.0);
  });
});
