/**
 * Re-exports from @webdit/shared. The shard format spec lives there so the
 * converter and runtime can never drift.
 */
export {
  packShard,
  parseBundleShard,
  type PackedShard,
  type ShardSummary,
} from "@webdit/shared";
