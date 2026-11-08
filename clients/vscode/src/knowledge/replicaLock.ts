/** The replica pump's lock lives in agent-tools (it is shared with the browser host); this keeps the editor's import path. */
export {
  LOCK_REFRESH_MS, LOCK_STALE_MS, acquireReplicaLock, fileReplicaLock, lockFileName,
  type ReplicaLock, type ReplicaLockPort,
} from "@builderforce/agent-tools/knowledge";
