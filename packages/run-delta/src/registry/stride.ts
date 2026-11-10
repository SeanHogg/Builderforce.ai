/**
 * registry/stride.ts — the C5.7 STRIDE template as DATA: every security rule id → the threat category
 * its findings carry as `params.stride`, so the card can group security findings by threat. A rule whose
 * category depends on what it found (a taint path into `exec` is elevation, into `innerHTML` tampering)
 * maps through one of its own params.
 *
 * {@link withStride} applies the mapping to a rule's output on both sides (params never enter an identity,
 * so lineage is untouched). It never overwrites a `stride` a rule set itself. Analyzer adapters in the
 * security dimension wrap their rows the same way; an id with no mapping is passed through unchanged.
 */

import type { DeltaRule, RuleFinding, StrideCategory } from '../contract.js';

export const STRIDE_CATEGORIES: readonly StrideCategory[] = [
    'spoofing', 'tampering', 'repudiation', 'information-disclosure', 'denial-of-service', 'elevation-of-privilege',
];

export interface StrideByParam {
    /** The finding param whose value picks the category. */
    by: string;
    values: Readonly<Record<string, StrideCategory>>;
    fallback: StrideCategory;
}

/** A SARIF result's CWE (`params.cwe`) → its threat; any other weakness is tampering. */
const SARIF_STRIDE: StrideByParam = {
    by: 'cwe',
    values: {
        'CWE-78': 'elevation-of-privilege', 'CWE-77': 'elevation-of-privilege', 'CWE-94': 'elevation-of-privilege',
        'CWE-95': 'elevation-of-privilege', 'CWE-502': 'elevation-of-privilege', 'CWE-269': 'elevation-of-privilege',
        'CWE-79': 'tampering', 'CWE-89': 'tampering', 'CWE-943': 'tampering', 'CWE-1321': 'tampering',
        'CWE-22': 'information-disclosure', 'CWE-918': 'information-disclosure', 'CWE-200': 'information-disclosure',
        'CWE-798': 'information-disclosure', 'CWE-327': 'information-disclosure', 'CWE-328': 'information-disclosure',
        'CWE-287': 'spoofing', 'CWE-352': 'spoofing', 'CWE-601': 'spoofing', 'CWE-295': 'spoofing',
        'CWE-400': 'denial-of-service', 'CWE-1333': 'denial-of-service', 'CWE-770': 'denial-of-service',
        'CWE-778': 'repudiation', 'CWE-117': 'repudiation',
    },
    fallback: 'tampering',
};

export const STRIDE_BY_RULE: Readonly<Record<string, StrideCategory | StrideByParam>> = {
    // C5.1 attack surface
    'guard-removed': 'spoofing',
    'guard-weakened': 'elevation-of-privilege',
    'entry-added': 'spoofing',
    'entry-removed': 'denial-of-service',
    'method-widened': 'tampering',
    'new-untrusted-input': 'tampering',
    // C5.2 taint-lite, by sink kind
    'taint-path': {
        by: 'sink',
        values: {
            'command-exec': 'elevation-of-privilege',
            'dynamic-code': 'elevation-of-privilege',
            'deserialization': 'elevation-of-privilege',
            'html': 'tampering',
            'sql-raw': 'tampering',
            'ssrf': 'information-disclosure',
            'path-traversal': 'information-disclosure',
            'open-redirect': 'spoofing',
            'regex-injection': 'denial-of-service',
        },
        fallback: 'tampering',
    },
    // C5.3 capabilities and crypto
    'capability-added': {
        by: 'key',
        values: {
            'process-exec': 'elevation-of-privilege',
            'dynamic-code': 'elevation-of-privilege',
            'native-addon': 'elevation-of-privilege',
            'fs-write': 'tampering',
            'network-server': 'spoofing',
            'network-client': 'information-disclosure',
            'env-read': 'information-disclosure',
        },
        fallback: 'elevation-of-privilege',
    },
    'weak-crypto': 'information-disclosure',
    // C5.4 supply chain
    'install-script-added': 'elevation-of-privilege',
    // C5.4 / C5.5 L3 analyzer kinds (`registry/analyzers.ts`): tagged in `engine/analyzers.ts` with `tagStride`
    'vulnerable-dependency': 'elevation-of-privilege',
    'secret-leak': 'information-disclosure',
    // C5.2 / C12 SARIF tools (Semgrep, CodeQL), by the result's CWE
    'semgrep-finding': SARIF_STRIDE,
    'codeql-finding': SARIF_STRIDE,
    // C5.5 secrets
    'secret-added': 'information-disclosure',
    // §12.5 the run's own gate
    'delta-config-changed': 'tampering',
    // C5.6 config and infra surface
    'tls-verify-disabled': 'spoofing',
    'cors-permissive': 'information-disclosure',
    'cookie-insecure': 'spoofing',
    'csp-permissive': 'tampering',
    'debug-enabled': 'information-disclosure',
    'workflow-permissive': 'elevation-of-privilege',
    'container-root': 'elevation-of-privilege',
    'infra-surface-added': 'information-disclosure',
};

/** The STRIDE category of one finding of `ruleId`, if the rule is mapped. */
export function strideOf(ruleId: string, params: Readonly<Record<string, string | number>>): StrideCategory | undefined {
    const m = STRIDE_BY_RULE[ruleId];
    if (m === undefined) return undefined;
    if (typeof m === 'string') return m;
    const v = params[m.by];
    return (v !== undefined ? m.values[String(v)] : undefined) ?? m.fallback;
}

/**
 * THE tagger: one finding of `ruleId` (a rule or an analyzer kind) with its `params.stride` set, when the id
 * is mapped and the finding has none yet. Rule rows get it through {@link withStride}; analyzer kinds in
 * `engine/analyzers.ts`.
 */
export function tagStride<F extends { params: Record<string, string | number> }>(ruleId: string, f: F): F {
    if (f.params['stride'] !== undefined) return f;
    const stride = strideOf(ruleId, f.params);
    return stride ? { ...f, params: { ...f.params, stride } } : f;
}

/** A security rule whose findings carry `params.stride` (identity, severity and evidence untouched). */
export function withStride(rule: DeltaRule): DeltaRule {
    if (rule.dimension !== 'security' || STRIDE_BY_RULE[rule.id] === undefined) return rule;
    const tag = (f: RuleFinding): RuleFinding => tagStride(rule.id, f);
    return {
        ...rule,
        derive(input) {
            const out = rule.derive(input);
            return { before: out.before.map(tag), after: out.after.map(tag) };
        },
    };
}
