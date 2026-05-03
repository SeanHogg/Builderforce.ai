/**
 * Re-exports from @webdit/shared. The shard format spec lives there so the
 * converter and runtime can never drift.
 */
import { parseBundleShard as sharedParse } from "@webdit/shared";
import type { QuantizedTensor } from "@webdit/shared";

export function parseBundleShard(buf: Uint8Array): Map<string, QuantizedTensor> {
  return sharedParse(buf).tensors;
}
