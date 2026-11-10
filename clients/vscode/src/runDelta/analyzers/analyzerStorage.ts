/**
 * Where the run delta's L3 analyzers keep what belongs to the EXTENSION, not to a repository: osv-scanner's offline
 * vulnerability database (`OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY`, PRD 41 §C5.4), under the extension's global storage.
 * Set once at activation (`capabilityWiring.ts`); unset (tests, an early run) ⇒ no offline database: osv scans online.
 */

import * as path from "node:path";

let storage: string | undefined;

export function setAnalyzerStorage(globalStorage: string): void {
  storage = globalStorage;
}

/** osv-scanner's offline database folder, or undefined when the extension's storage is not known. */
export function osvDatabaseDir(): string | undefined {
  return storage ? path.join(storage, "osv-scanner") : undefined;
}
