/**
 * Re-exports from @webdit/shared. Half-precision conversions live there so
 * runtime + converter share one implementation.
 */
export { floatToHalf, halfToFloat, bfloat16ToFloat } from "@webdit/shared";
