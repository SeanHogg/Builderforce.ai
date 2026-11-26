/** The error codes a graph build answers with. Dependency-free: the live refresh reads them without loading the worker host. */

/** A build the asker stopped answers this; a superseded load is dropped, never a failure. */
export const GRAPH_BUILD_ABORTED = "graph_build_aborted";
/** A build ended for holding the worker past `GRAPH_BUILD_MS` answers this. */
export const GRAPH_BUILD_TIMEOUT = "graph_build_timeout";
