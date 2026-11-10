/**
 * rules/taintPath.ts — `taint-path` (security; C5.2): untrusted input (a registry SOURCE: request body,
 * query, params, headers, webview message data, argv, uploaded content, MCP tool arguments) reaches a
 * registry SINK (shell exec, eval, innerHTML, raw SQL, a fetch target, an fs path, a redirect, a
 * deserializer, a RegExp) within one function, with no registry SANITIZER on the path.
 *
 * Identity is anchored at the SINK — `<path>#<sink kind>#<source kind>` plus the normalized sink call — so
 * moving code keeps it, adding a sanitizer RESOLVES it and a new path is `introduced`. Evidence is the hop
 * chain (source → variables → sink). Severity by sink kind ({@link SINK_SEVERITY}): code execution, raw
 * SQL and deserialization are errors, the rest warnings. Always `heuristic`; Semgrep / CodeQL SARIF (C12)
 * is the measured source when installed.
 *
 * Heuristic: text-level def-use (`support/taint.ts`); WS4 tree-sitter def-use facts replace the scan.
 */

import type { DeltaRule, Evidence, RuleFinding, Severity } from '../contract.js';
import { filePairs, isCodePath, isTestPath, redact, squash, type TextView } from './support/files.js';
import { heuristicFinding, Ordinals, ruleIdentity } from './support/identity.js';
import { taintPaths, taintRegistryOf, type TaintRegistry } from './support/taint.js';

/** Sink kinds whose taint is an error (a repo-added kind defaults to warn). */
export const SINK_SEVERITY: Readonly<Record<string, Severity>> = {
    'command-exec': 'error',
    'dynamic-code': 'error',
    'sql-raw': 'error',
    'deserialization': 'error',
};

const MAX_SNIPPET = 200;

function findings(view: TextView, side: 'before' | 'after', reg: TaintRegistry): RuleFinding[] {
    const ordinals = new Ordinals();
    return taintPaths(view, reg).map((p) => {
        // The anchor hashes the normalized sink CALLEE (+ sink and source kinds), not its argument text, so an
        // edit inside the call keeps the identity; equal callees in one file are told apart by ordinal.
        const callee = redact(p.sinkEntry);
        const primary = `${view.path}#${p.sink}#${p.source}`;
        // Notes are numbered so the chain reads in order wherever evidence is sorted by location.
        const evidence: Evidence[] = p.hops.map((h, i) => ({
            side, path: view.sidePath, line: view.lineAt(h.offset),
            snippet: squash(redact(view.lineText(h.offset))).slice(0, MAX_SNIPPET), note: `${i + 1}. ${redact(h.note)}`,
        }));
        return heuristicFinding(
            ruleIdentity(taintPath, 'file', primary, { members: [view.path], snippet: callee, ordinal: ordinals.next(`${primary}\u0000${callee}`) }),
            SINK_SEVERITY[p.sink] ?? 'warn',
            { file: view.path, sink: p.sink, source: p.source, call: callee, hops: p.hops.length, chain: p.hops.map((h) => redact(h.note)).join(' → ') },
            evidence,
        );
    });
}

export const taintPath: DeltaRule = {
    id: 'taint-path',
    version: 2,
    dimension: 'security',
    reads: ['content'],
    derive(input) {
        const reg = taintRegistryOf(input);
        const out = { before: [] as RuleFinding[], after: [] as RuleFinding[] };
        for (const pair of filePairs(input)) {
            if (!isCodePath(pair.path) || isTestPath(pair.path)) continue;
            if (pair.before) out.before.push(...findings(pair.before, 'before', reg));
            if (pair.after) out.after.push(...findings(pair.after, 'after', reg));
        }
        return out;
    },
};
