/** Types for `buildInputs.mjs` — the webview build's input/output stamp. */

/** The files `vite.config.ts` reads the versions it inlines from; each list is tried in order. */
export declare function inlinedVersionFiles(): { ui: string[]; brain: string[]; runtime: string[] };

/** The real files among Rollup's module ids. */
export declare function realModuleFiles(ids: Iterable<string>): Set<string>;

export declare function removeStamp(): void;

/** Writes the stamp for the build that just finished; false (and no stamp) when an input changed mid-build. */
export declare function writeStamp(args: { moduleFiles: Iterable<string>; buildId: string; startedAt: number }): boolean;

/** Why the webview must be rebuilt, or null when the stamp proves the output is current. Throws when unsure. */
export declare function rebuildReason(): string | null;
