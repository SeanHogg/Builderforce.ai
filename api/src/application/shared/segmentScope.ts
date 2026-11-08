/**
 * The `(tenantId, segmentId)` pair every segment-threaded governance read and write filters by.
 * ONE exported type: findings, SOC 2 reads, DSR execution and the security step all take this
 * instead of each declaring its own copy.
 */
export interface SegmentScope {
  tenantId: number;
  segmentId: string;
}
