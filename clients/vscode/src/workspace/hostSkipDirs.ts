/** Directories only this host's own tooling creates (the verifier's scratch tree): skipped by the definition index and the codebase scan alike, on top of the shared `WORKSPACE_SKIP_DIRS`. */
export const HOST_EXTRA_SKIP_DIRS: ReadonlySet<string> = new Set(["bf-verify-fdc"]);
