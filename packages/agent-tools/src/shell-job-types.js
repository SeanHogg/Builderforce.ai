/**
 * The shell's per-call options and its BACKGROUND job shapes — split from
 * `capabilities.ts` (already the whole capability catalog) because they are one
 * subsystem: Stop reaching the process (`signal`), and a long command that runs on
 * while the agent keeps working (`start` → `poll` → `kill`).
 */
export {};
//# sourceMappingURL=shell-job-types.js.map