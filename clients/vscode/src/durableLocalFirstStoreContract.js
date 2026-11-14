/**
 * The VSIX durable local-first store's CONTRACT: what `createDurableLocalFirstStore` returns and
 * takes. Split out of `durableLocalFirstStore.ts`, which re-exports all of it.
 */
import { INDEXEDDB_REDACTION_RULE, } from "@builderforce/local-first";
/**
 * Stated redaction rule for this surface. Identical to the IndexedDB adapter:
 * only `exportForUploadOrLog()` may leave the device. Not a second policy.
 */
export const VSIX_LOCAL_FIRST_REDACTION_RULE = INDEXEDDB_REDACTION_RULE;
//# sourceMappingURL=durableLocalFirstStoreContract.js.map