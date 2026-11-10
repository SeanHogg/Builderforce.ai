/**
 * contract/registries.ts — the data registries (PRD 41 C5–C8) a delta runs with, split out of
 * `contract.ts` (which re-exports them, so every import keeps working). Pure types. Built-in defaults live
 * in `registry/defaults.ts`; a repo extends them through `.builderforce/delta.json`, read from the run's
 * BEFORE side (`registry/overrides.ts`).
 */

/** Data registries (C5–C8). Built-in defaults in `registry/`, extended per repo by `.builderforce/delta.json`. */
export interface DeltaRegistries {
    /** Guard names, ranked (higher = stronger), e.g. `{ requireSuperadmin: 40, requireAuth: 10 }`. */
    guards: Readonly<Record<string, number>>;
    /** Module specifiers / call names by capability (`process-exec`, `fs-write`, `network`, `dynamic-code`, `native-addon`, `env-read`). */
    capabilities: Readonly<Record<string, readonly string[]>>;
    /** Weak-crypto patterns (regex sources). */
    weakCrypto: readonly string[];
    /** Awaited I/O call patterns (regex sources) for `io-in-loop`. */
    io: readonly string[];
    /** Suppression markers for `suppression-added`. */
    suppressions: readonly string[];
    /** Matcher strength classes, strongest first. */
    matchers: readonly (readonly string[])[];
    /**
     * Rule ids that block an autonomous run's finalization (§12.5) when they have an introduced or changed
     * finding at ERROR severity, or cannot certify the run (`RunDelta.blocking`). A warn-level rule
     * listed here never blocks.
     */
    blocking: readonly string[];
    /**
     * C6.1 `cache-bypass` (a repo rule): `reads` are repository read functions registered as cacheable;
     * `readThrough` are the read-through helpers (`getOrSetCached`) a call to one must sit inside.
     */
    cacheable: { readonly reads: readonly string[]; readonly readThrough: readonly string[] };
    /**
     * C5.2 taint-lite SOURCES by kind (`http-request`, `webview-message`, `process-argv`, `upload`, `mcp-args`).
     * Entry forms (`rules/support/entryForms.ts`): `name(` a call, `a.b` a member access,
     * `.name(` a method on any receiver (but `JSON`). Literal text, never a regex.
     */
    taintSources: Readonly<Record<string, readonly string[]>>;
    /**
     * C5.2 SINKS by kind (`command-exec`, `dynamic-code`, `html`, `sql-raw`, `ssrf`, `path-traversal`,
     * `open-redirect`, `deserialization`, `regex-injection`). Entry forms as {@link taintSources}, plus
     * `x=` an assignment (its right-hand side is the sink argument) and `name(*` a call where ANY argument
     * counts; a plain `name(` reads only the FIRST argument (so a parameterized query's bindings never taint it).
     */
    taintSinks: Readonly<Record<string, readonly string[]>>;
    /**
     * C5.2 SANITIZERS (call / method entry forms) grouped by the sink kind they protect (`*` = every kind):
     * a sanitizer cuts a path only when the source or tainted name sits inside its argument span, and only
     * for the sink kinds of its group (an HTML escaper never cleans a shell command).
     */
    taintSanitizers: Readonly<Record<string, readonly string[]>>;
    /**
     * C5.6 config-surface patterns (regex sources) per check: `tls-verify-disabled`, `cors-permissive`,
     * `cors-credentials` (escalates `cors-permissive` to error), `csp-permissive`, `debug-enabled`,
     * `workflow-permissive`. Built-ins run over the whole text; repo-added ones line by line, capped.
     */
    insecureConfig: Readonly<Record<string, readonly string[]>>;
    /**
     * C5.7 STRIDE coverage: per {@link StrideCategory}, the guard / middleware / helper names that cover it.
     * The checklist row of an `entry-added` / `capability-added` / `method-widened` finding names the first
     * one present, or `uncovered`.
     */
    strideCoverage: Readonly<Record<string, readonly string[]>>;
}

/** C5.7 STRIDE threat categories (Microsoft's model): the `stride` param of every security finding. */
export type StrideCategory =
    | 'spoofing'
    | 'tampering'
    | 'repudiation'
    | 'information-disclosure'
    | 'denial-of-service'
    | 'elevation-of-privilege';
