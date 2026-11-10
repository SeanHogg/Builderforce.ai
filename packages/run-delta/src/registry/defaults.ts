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
    'catch-all-added',
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
    // Regex sources (compiled `gi`) over comment-masked source; built-ins run over the whole text, repo ones
    // per line. No top-level alternation, so each has a literal that prefilters it (`mandatoryLiteral`).
    weakCrypto: [
        String.raw`createHash\(\s*['"\x60](?:md5|sha1)['"\x60]`,
        String.raw`createHmac\(\s*['"\x60](?:md5|sha1)['"\x60]`,
        String.raw`['"\x60][a-z0-9]*-(?:\d+-)?ecb['"\x60]`,
        String.raw`(?:token|secret|password|nonce|salt)[^\n]{0,80}Math\.random\(`,
        String.raw`Math\.random\([^\n]{0,80}(?:token|secret|password|nonce|salt)`,
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
    // C6.1 `cache-bypass`: the repo lists its cacheable repository reads in `.builderforce/delta.json`;
    // `getOrSetCached` is this repo's read-through helper.
    cacheable: { reads: [], readThrough: ['getOrSetCached'] },
    // C5.2 taint-lite, as entry forms (rules/support/entryForms.ts). `process.env` is deliberately not a
    // source: an operator-set value reaching `fetch` is configuration, and env reads are `capability-added`.
    taintSources: {
        'http-request': [
            'req.body', 'req.query', 'req.params', 'req.headers', 'req.cookies', 'request.body', 'request.query', 'request.headers',
            'ctx.request.body', 'ctx.query', 'c.req.json(', 'c.req.query(', 'c.req.queries(', 'c.req.param(', 'c.req.header(',
            'c.req.parseBody(', 'c.req.formData(', 'c.req.text(', 'request.json(', 'request.formData(', 'request.text(', 'searchParams.get(',
        ],
        'webview-message': ['message.data', 'msg.data', 'event.data'],
        'process-argv': ['process.argv'],
        'upload': ['formData.get(', 'file.text(', 'file.arrayBuffer(', 'file.stream('],
        'mcp-args': ['params.arguments'],
    },
    taintSinks: {
        'command-exec': [
            'exec(', 'execSync(', '.execSync(', 'child_process.exec(', 'childProcess.exec(', 'cp.exec(', 'execaCommand(', 'execaCommandSync(',
            // The argv-taking forms: the program AND its arguments matter (`spawn('sh', ['-c', input])`).
            'spawn(*', '.spawn(*', 'spawnSync(*', '.spawnSync(*', 'execFile(*', '.execFile(*', 'execFileSync(*', '.execFileSync(*',
        ],
        'dynamic-code': [
            'eval(', 'new Function(', 'Function(', 'vm.runInThisContext(', 'vm.runInNewContext(', 'vm.runInContext(', 'new vm.Script(',
            'vm.compileFunction(',
        ],
        'html': ['.innerHTML=', '.outerHTML=', 'dangerouslySetInnerHTML=', 'document.write(', 'document.writeln(', '.insertAdjacentHTML(*'],
        'sql-raw': ['.query(', '.execute(', '.prepare(', '.$queryRawUnsafe(', '.$executeRawUnsafe(', '.unsafe(', 'sql.raw(', '.raw('],
        'ssrf': [
            'fetch(', 'axios(', 'axios.get(', 'axios.post(', 'axios.put(', 'axios.request(', 'got(', 'http.get(', 'https.get(',
            'http.request(', 'https.request(', 'undici.request(', 'new WebSocket(',
        ],
        'path-traversal': [
            'readFile(', '.readFile(', 'readFileSync(', '.readFileSync(', 'writeFile(', '.writeFile(', 'writeFileSync(', '.writeFileSync(',
            'createReadStream(', '.createReadStream(', 'createWriteStream(', '.createWriteStream(', 'unlink(', '.unlink(', '.rm(',
            'rmSync(', '.rmSync(', 'readdir(', '.readdir(', '.sendFile(',
        ],
        'open-redirect': ['redirect(', '.redirect(', 'location.assign(', 'location.replace(', 'location.href=', 'window.location='],
        'deserialization': ['unserialize(', '.unserialize(', 'deserialize(', '.deserialize(', 'yaml.load(', 'pickle.loads(', 'marshal.loads('],
        'regex-injection': ['new RegExp(', 'RegExp('],
    },
    // Grouped by the sink kind each protects (`*` = every kind: schema validation and numeric coercion).
    taintSanitizers: {
        '*': ['.parse(', '.safeParse(', '.parseAsync(', '.safeParseAsync(', 'parseInt(', 'parseFloat(', 'Number('],
        'html': ['escapeHtml(', 'escapeHTML(', 'encodeHtml(', 'escape(', 'DOMPurify.sanitize(', 'sanitizeHtml(', 'sanitize('],
        'ssrf': ['isAllowedUrl(', 'assertAllowedUrl(', 'encodeURIComponent('],
        'open-redirect': ['isAllowedUrl(', 'assertAllowedUrl(', 'isSafeRedirect('],
        'path-traversal': ['safeJoin(', 'resolveWithin(', 'path.basename(', 'basename('],
        'command-exec': ['shellQuote(', 'shellescape(', 'quote('],
        'regex-injection': ['escapeRegex(', 'escapeRegExp('],
        'sql-raw': ['escapeLiteral(', 'escapeIdentifier(', 'sqlstring.escape('],
    },
    // C5.6 regex sources (compiled `g`, line by line, case-sensitive), each passing `unsafeRegex`.
    insecureConfig: {
        'tls-verify-disabled': [
            String.raw`\brejectUnauthorized['"]?\s*:\s*false\b`,
            String.raw`\bNODE_TLS_REJECT_UNAUTHORIZED['"]?\s*[:=]\s*['"]?0\b`,
            String.raw`\bstrictSSL['"]?\s*:\s*false\b`,
            String.raw`\bstrict-ssl\s*=\s*false\b`,
            String.raw`\binsecureSkipVerify['"]?\s*:\s*true\b`,
            String.raw`\bverify\s*=\s*False\b`,
            String.raw`\bcurl\b[^\n]{0,200}\s(?:-k|--insecure)(?![\w-])`,
        ],
        'cors-permissive': [
            String.raw`\borigin['"]?\s*:\s*['"\x60]\*['"\x60]`,
            String.raw`\borigin['"]?\s*:\s*true\b`,
            String.raw`Access-Control-Allow-Origin['"\x60]?\s*[,:]\s*['"\x60]?\*`,
            String.raw`(?<![\w$.])cors\(\s*\)`,
        ],
        'cors-credentials': [
            String.raw`\bcredentials['"]?\s*:\s*true\b`,
            String.raw`Access-Control-Allow-Credentials['"\x60]?\s*[,:]\s*['"\x60]?true\b`,
        ],
        'csp-permissive': [
            String.raw`'unsafe-(?:inline|eval)'`,
            String.raw`\b(?:default|script)-src\b[^;\n]{0,200}\s\*(?![\w.])`,
            String.raw`\bcontentSecurityPolicy['"]?\s*:\s*false\b`,
        ],
        'debug-enabled': [
            String.raw`^\s*['"]?(?:DEBUG|debug)['"]?\s*[:=]\s*['"]?(?:(?:true|True|TRUE|1|yes|on)\b|\*)`,
            String.raw`\b(?:LOG_LEVEL|LOGLEVEL|logLevel|log_level)['"]?\s*[:=]\s*['"]?(?:debug|trace|verbose|DEBUG|TRACE|VERBOSE)\b`,
            String.raw`^\s*['"]?(?:verbose|VERBOSE)['"]?\s*[:=]\s*['"]?(?:true|1)\b`,
        ],
        'workflow-permissive': [
            // Anchored to the `on:` trigger (a key under it, an inline list, or a list item), never an `if:` mention.
            String.raw`^[ \t]*pull_request_target[ \t]*:`,
            String.raw`^[ \t]*on[ \t]*:[^\n#]*\bpull_request_target\b`,
            String.raw`^[ \t]*-[ \t]*pull_request_target[ \t]*$`,
            String.raw`^\s*permissions\s*:\s*write-all\b`,
        ],
    },
    // C5.7 what covers each STRIDE category on a new entry point or capability.
    strideCoverage: {
        'spoofing': ['requireAuth', 'bearerAuth', 'basicAuth', 'jwt', 'resolveMembership', 'RoleGate', 'requireSuperadmin', 'verifySignature'],
        'tampering': ['zValidator', 'validator', 'csrf', 'verifySignature'],
        'repudiation': ['auditLog', 'recordAudit', 'writeAudit'],
        'information-disclosure': ['requireAuth', 'bearerAuth', 'basicAuth', 'jwt', 'resolveMembership', 'RoleGate', 'requireSuperadmin'],
        'denial-of-service': ['rateLimit', 'rateLimiter', 'bodyLimit', 'timeout'],
        'elevation-of-privilege': ['RoleGate', 'requireSuperadmin', 'resolveMembership'],
    },
};
