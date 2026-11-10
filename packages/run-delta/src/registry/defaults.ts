/**
 * registry/defaults.ts — the built-in {@link DeltaRegistries} (PRD 41 C5–C8, §12.5). Pure data:
 * a repo extends them through `.builderforce/delta.json` ({@link withOverrides}); a new guard, sink
 * or matcher is a row here, never a branch in a rule.
 */

import type { DeltaRegistries } from '../contract.js';

/**
 * The C8.2 test-integrity rules. Any ERROR finding of one makes quality `worse` and the headline
 * "tests were weakened" (`assertion-edited-with-impl` is an error only in a consolidation run).
 */
export const TEST_INTEGRITY_RULES: readonly string[] = [
    'assertion-edited-with-impl',
    'assertions-reduced',
    'matcher-weakened',
    'only-added',
    'snapshot-updated-with-impl',
    'suppression-added',
    'test-deleted',
    'test-skipped',
    'timeout-raised',
];

/** The C8.2 rules that can report at error severity: the ones the autonomous policy blocks on. */
export const TEST_INTEGRITY_ERROR_RULES: readonly string[] = [
    'assertion-edited-with-impl',
    'assertions-reduced',
    'matcher-weakened',
    'only-added',
    'test-deleted',
    'test-skipped',
];

/** A run that edits its own gate (`.builderforce/delta.json`). */
export const DELTA_CONFIG_RULE = 'delta-config-changed';

export const DEFAULT_REGISTRIES: DeltaRegistries = {
    // Ranked: higher = stronger. A route that loses every guard is `guard-removed`; one whose strongest
    // guard is replaced by a weaker one is `guard-weakened`.
    guards: {
        requireSuperadmin: 40,
        RoleGate: 30,
        resolveMembership: 20,
        requireAuth: 10,
        // Hono's auth middlewares.
        bearerAuth: 10,
        basicAuth: 10,
        jwt: 10,
    },
    // Entry forms: a bare name is a module specifier (`import`/`require`/`import()`), `name(` a call,
    // `a.b` a member access, `*suffix` a specifier suffix (native addons).
    capabilities: {
        'process-exec': ['child_process', 'node:child_process', 'execa', 'cross-spawn'],
        'fs-write': [
            'writeFile(', 'writeFileSync(', 'appendFile(', 'appendFileSync(', 'createWriteStream(',
            'rm(', 'rmSync(', 'unlink(', 'unlinkSync(', 'rename(', 'renameSync(', 'copyFile(', 'copyFileSync(',
        ],
        'network-server': [
            'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2', 'net', 'node:net', 'dgram', 'node:dgram',
            'createServer(',
        ],
        'network-client': ['fetch('],
        'dynamic-code': ['eval(', 'new Function(', 'vm', 'node:vm'],
        'native-addon': ['bindings', 'node-gyp-build', '*.node'],
        'env-read': ['process.env'],
    },
    // Regex sources (compiled `gi`), matched per line over comment-masked source.
    weakCrypto: [
        String.raw`createHash\(\s*['"\x60](?:md5|sha1)['"\x60]`,
        String.raw`createHmac\(\s*['"\x60](?:md5|sha1)['"\x60]`,
        String.raw`['"\x60][a-z0-9]*-(?:\d+-)?ecb['"\x60]`,
        String.raw`(?:token|secret|password|nonce|salt)[^\n]{0,80}Math\.random\(|Math\.random\([^\n]{0,80}(?:token|secret|password|nonce|salt)`,
    ],
    // Regex sources (compiled without flags) tested against the expression right after an `await`.
    io: [
        String.raw`^(?:this\.)?(?:db|tx|prisma|knex|pool|drizzle|sql|database|client|repo)\s*[.(\x60]`,
        String.raw`^fetch\s*\(`,
        String.raw`^(?:fs|fsp|fsPromises)\s*\.\s*(?:promises\s*\.\s*)?[A-Za-z]+\s*\(`,
        String.raw`^(?:readFile|writeFile|appendFile|readdir|stat|lstat|mkdir|rm|unlink|rename|copyFile|access|open)\s*\(`,
        String.raw`^(?:c\.)?env\s*\.\s*[A-Z][A-Z0-9_]*\s*\.\s*(?:get|put|list|delete|head|getWithMetadata|prepare)\s*\(`,
        String.raw`^[\w$.]*(?:KV|Kv|R2|Bucket|BUCKET|Store)\s*\.\s*(?:get|put|list|delete|head)\s*\(`,
        String.raw`^[\w$.]+\s*\.\s*(?:query|execute|findMany|findFirst|findUnique|findOne|insertOne|updateOne|deleteOne|batch)\s*\(`,
    ],
    suppressions: ['@ts-ignore', '@ts-expect-error', '@ts-nocheck', 'eslint-disable', '# noqa', 'as any'],
    // Strongest first (C8.2: toEqual > toMatchObject > toBeTruthy/toBeDefined).
    matchers: [
        [
            'toBe', 'toEqual', 'toStrictEqual', 'toThrow', 'toThrowError', 'toMatchSnapshot', 'toMatchInlineSnapshot',
            'toHaveBeenCalledWith', 'toHaveBeenCalledTimes', 'toHaveBeenLastCalledWith', 'toHaveBeenNthCalledWith',
            'toHaveReturnedWith', 'toBeCloseTo', 'toBeNull', 'toBeNaN',
        ],
        [
            'toMatchObject', 'toContain', 'toContainEqual', 'toHaveLength', 'toHaveProperty', 'toMatch', 'toHaveBeenCalled',
            'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toBeInstanceOf', 'toSatisfy',
        ],
        ['toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeUndefined'],
    ],
    // §12.5: `guard-removed` and every C8.2 error block finalization of an autonomous run; so does a run
    // that edits its own delta policy.
    blocking: ['guard-removed', DELTA_CONFIG_RULE, ...TEST_INTEGRITY_ERROR_RULES],
};
