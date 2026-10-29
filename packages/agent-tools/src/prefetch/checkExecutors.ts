/**
 * The shared READ executors that run one analyzer and report what it found: lint,
 * typecheck (the `tsc --noEmit` fallback — the editor asks its LSP first), dependency audit
 * (osv-scanner or the lockfile's `npm audit`), secrets (gitleaks, redacted) and the
 * tests related to the focus files (vitest, the file list only).
 *
 * Each runs only when its tool was detected, under the action's deadline signal, and
 * caps what it returns. Pure: everything goes through the host's shell and repo.
 */

import type { PrefetchExecHost, PrefetchOutput, PrefetchRunner } from './contract.js';
import { PREFETCH_LIST_CAP, PREFETCH_SCRATCH_DIR, capOutput, fenced, focusArgs, jsonIn, runTool, toolOf } from './exec.js';

const JS_TS = /\.(?:[cm]?[jt]sx?)$/i;
const PY = /\.py$/i;

const out = (actionId: string, text: string, data?: Record<string, unknown>): PrefetchOutput =>
    ({ actionId, text, ...(data ? { data } : {}) });

/** ESLint's JSON report as `path:line:col severity message (rule)` lines. */
function eslintLines(report: unknown): { lines: string[]; errors: number; warnings: number } {
    const files = Array.isArray(report) ? report as Array<{ filePath?: string; messages?: Array<{ line?: number; column?: number; severity?: number; message?: string; ruleId?: string | null }> }> : [];
    const lines: string[] = [];
    let errors = 0, warnings = 0;
    for (const f of files) {
        for (const m of f.messages ?? []) {
            if (m.severity === 2) errors++; else warnings++;
            lines.push(`${f.filePath ?? '?'}:${m.line ?? 0}:${m.column ?? 0} ${m.severity === 2 ? 'error' : 'warning'} ${m.message ?? ''}${m.ruleId ? ` (${m.ruleId})` : ''}`);
        }
    }
    return { lines, errors, warnings };
}

export function lintCheck(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'linter');
            if (!tool) return undefined;
            const files = focusArgs(host, (p) => (tool.id === 'ruff' ? PY.test(p) : JS_TS.test(p)));
            const scope = files.length ? files.join(' ') : '.';
            if (tool.id === 'eslint') {
                const r = await runTool(host, tool, `--format json ${scope}`, signal);
                if (!r) return undefined;
                const { lines, errors, warnings } = eslintLines(jsonIn(r.out));
                if (lines.length === 0 && !r.ok) return out('lint.check', fenced('ESLint did not finish', r.out, 2_000));
                const text = lines.length === 0
                    ? `ESLint: no problems in ${files.length ? `${files.length} file(s)` : 'the workspace'}.`
                    : fenced(`ESLint: ${errors} error(s), ${warnings} warning(s)`, lines.join('\n'));
                return out('lint.check', text, { tool: tool.id, errors, warnings });
            }
            const args = tool.id === 'ruff' ? `check --output-format concise ${scope}` : `lint ${scope}`;
            const r = await runTool(host, tool, args, signal);
            if (!r) return undefined;
            return out('lint.check', fenced(`${tool.id} ${r.ok ? '— no problems' : 'findings'}`, r.out || '(no output)'), { tool: tool.id, clean: r.ok });
        },
    };
}

/** `tsc --noEmit` over the project, filtered to the focus files when there are some. */
export function typecheckWithTsc(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'typescript');
            if (!tool) return undefined;
            const r = await runTool(host, tool, '--noEmit --pretty false', signal);
            if (!r) return undefined;
            const focus = (host.focusFiles?.() ?? []).map((f) => f.split('\\').join('/'));
            const errors = r.out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
            const shown = focus.length ? errors.filter((l) => focus.some((f) => l.split('\\').join('/').startsWith(f))) : errors;
            if (r.ok || errors.length === 0) return out('diag.typecheck', 'TypeScript: no type errors (tsc --noEmit).', { source: 'tsc', errors: 0 });
            const lines = (shown.length ? shown : errors).slice(0, 200);
            return out('diag.typecheck', fenced(`TypeScript: ${errors.length} error(s)${shown.length && focus.length ? `, ${shown.length} in the files you are working in` : ''}`, lines.join('\n')), { source: 'tsc', errors: errors.length });
        },
    };
}

/** osv-scanner's JSON: one line per vulnerable package with its advisory ids. */
function osvLines(report: unknown): string[] {
    const results = (report as { results?: Array<{ packages?: Array<{ package?: { name?: string; version?: string }; vulnerabilities?: Array<{ id?: string }> }> }> } | undefined)?.results ?? [];
    return results.flatMap((r) => (r.packages ?? []).map((p) =>
        `${p.package?.name ?? '?'}@${p.package?.version ?? '?'}: ${(p.vulnerabilities ?? []).map((v) => v.id).filter(Boolean).join(', ')}`));
}

export function depsAudit(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'dependency-audit');
            if (!tool) return undefined;
            if (tool.id === 'osv-scanner') {
                const r = await runTool(host, tool, '--format json --recursive .', signal);
                const lines = r ? osvLines(jsonIn(r.out)) : undefined;
                if (!r || !lines) return undefined;
                return out('deps.audit', lines.length === 0
                    ? 'Dependency audit (osv-scanner): no known vulnerabilities.'
                    : fenced(`Dependency audit (osv-scanner): ${lines.length} vulnerable package(s)`, lines.slice(0, PREFETCH_LIST_CAP * 3).join('\n')), { tool: tool.id, packages: lines.length });
            }
            const r = await runTool(host, tool, '--json', signal);
            const counts = r ? npmAuditCounts(jsonIn(r.out)) : undefined;
            if (!counts) return undefined;
            const text = counts.total === 0
                ? `Dependency audit (${tool.command}): no known vulnerabilities.`
                : [`Dependency audit (${tool.command}): ${counts.total} vulnerabilit${counts.total === 1 ? 'y' : 'ies'}.`, '',
                    '| Severity | Count |', '| --- | ---: |',
                    `| critical | ${counts.critical} |`, `| high | ${counts.high} |`, `| moderate | ${counts.moderate} |`, `| low | ${counts.low} |`,
                    '', `Run \`${tool.command}\` for the advisories and fixes.`].join('\n');
            return out('deps.audit', text, { tool: tool.id, ...counts });
        },
    };
}

/** gitleaks, REDACTED: rule, file and line only — a secret is never echoed into a turn. */
export function secretsScan(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'gitleaks');
            const read = host.caps.repoRead;
            if (!tool || !read) return undefined;
            const reportPath = `${PREFETCH_SCRATCH_DIR}/gitleaks.json`;
            const r = await runTool(host, tool, `detect --source . --no-banner --redact --report-format json --report-path ${reportPath}`, signal);
            if (!r) return undefined;
            const file = await read.readFile(reportPath).catch(() => undefined);
            const findings = file?.ok ? jsonIn(file.content ?? '') : undefined;
            if (!Array.isArray(findings)) return undefined;
            if (findings.length === 0) return out('secrets.scan', 'Secrets scan (gitleaks): no leaks found.', { leaks: 0 });
            const lines = (findings as Array<{ RuleID?: string; File?: string; StartLine?: number }>).slice(0, PREFETCH_LIST_CAP * 2)
                .map((f) => `${f.File ?? '?'}:${f.StartLine ?? 0} ${f.RuleID ?? 'secret'}`);
            return out('secrets.scan', `${fenced(`Secrets scan (gitleaks): ${findings.length} possible leak(s), values redacted`, lines.join('\n'))}\n\nRotate any real credential before removing it from history.`, { leaks: findings.length });
        },
    };
}

/** The test FILES vitest relates to the focus files — names only, never their results. */
export function testsRelated(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'vitest');
            const files = focusArgs(host, (p) => JS_TS.test(p));
            if (!tool || files.length === 0) return undefined;
            const r = await runTool(host, tool, `related --run --reporter=json --passWithNoTests ${files.join(' ')}`, signal);
            const report = r ? jsonIn(r.out) as { testResults?: Array<{ name?: string }> } | undefined : undefined;
            if (!report || !Array.isArray(report.testResults)) return undefined;
            const names = [...new Set(report.testResults.map((t) => t.name).filter((n): n is string => !!n))];
            if (names.length === 0) return out('tests.related', 'Related tests: none cover the files you are working in.', { tests: 0 });
            return out('tests.related', capOutput(`Related test files (vitest related):\n${names.map((n) => `- ${n}`).join('\n')}`), { tests: names.length });
        },
    };
}
