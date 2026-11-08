/**
 * The editor's REPLICA HOST: ONE `createReplicaHost()` for this extension host, re-exported under the names the knowledge
 * service, bridge, review sessions and sync status already import. The host itself (queue, pump, quiet timer, lock) lives in
 * `@builderforce/agent-tools/knowledge` so the browser runs the same one.
 */

import { createReplicaHost } from "@builderforce/agent-tools/knowledge";

export { BACKGROUND_TRANSIENT_STREAK, MIN_SEND_INTERVAL_MS, type PumpSource, type UploadMarks } from "@builderforce/agent-tools/knowledge";

const host = createReplicaHost();

export const configureReplicaLog = host.configureReplicaLog;
export const replicaQueueFor = host.replicaQueueFor;
export const replicaStatusOf = host.replicaStatusOf;
export const onReplicaState = host.onReplicaState;
export const replicatedStoreOf = host.replicatedStoreOf;
export const duringReview = host.duringReview;
export const setRootReviewing = host.setRootReviewing;
export const isRootReviewing = host.isRootReviewing;
export const replicaDrained = host.replicaDrained;
export const stopReplicaPump = host.stopReplicaPump;
export const startReplicaPump = host.startReplicaPump;
export const retryReplica = host.retryReplica;
export const resumeAuthPaused = host.resumeAuthPaused;
export const kickReplicaPump = host.kickReplicaPump;
export const resumeReplica = host.resumeReplica;
export const queueFirstSyncOnce = host.queueFirstSyncOnce;
export const disposeReplicas = host.disposeReplicas;
