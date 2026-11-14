// The store-free core (createOutbox, policy, types) lives in ./core.ts for no-DOM hosts.
export * from "./core.js";
export { createIndexedDbOutboxStore, listIndexedDbOutboxPartitions, createMemoryOutboxStore, createOnlineSignal, createSnapshotOutboxStore, } from "./stores.js";
//# sourceMappingURL=index.js.map