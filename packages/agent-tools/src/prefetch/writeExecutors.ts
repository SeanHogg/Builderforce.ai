/**
 * The shared WRITE executors — fixes, formatting, scaffolds, code generation and codemods.
 * Every row they back is `sideEffect: 'write'`, so the gate runs one ONLY after the person
 * confirmed it on the composer's confirm chip (`runGate`: no confirm ⇒ declined); these
 * functions never ask and never run on their own.
 *
 * Whatever the person typed never reaches a command line raw: generator and template
 * names are single words, codemod patterns travel in a rule FILE (written through the
 * host's repo), and paths are checked by `safePath`.
 */

import type { PrefetchExecHost, PrefetchOutput, PrefetchRunner } from './contract.js';
import { PREFETCH_SCRATCH_DIR, fenced, focusArgs, runTool, slashArgs, toolOf, type ToolRun } from './exec.js';

const JS_TS = /\.(?:[cm]?[jt]sx?|json|css|scss|md)$/i;
const PY = /\.py$/i;
/** One word a generator, a template or a variable may be named. */
const WORD = /^[\w-]{1,64}$/;

function ran(actionId: string, title: string, r: ToolRun, data?: Record<string, unknown>): PrefetchOutput {
    return { actionId, text: fenced(`${title}${r.ok ? '' : ' — finished with problems'}`, r.out || '(no output)'), data: { ok: r.ok, ...data } };
}

/** The linter's own fix mode over the focus files (else the workspace). */
export function lintFix(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'linter');
            if (!tool) return undefined;
            const files = focusArgs(host, (p) => (tool.id === 'ruff' ? PY.test(p) : JS_TS.test(p)));
            const scope = files.length ? files.join(' ') : '.';
            const args = tool.id === 'eslint' ? `--fix ${scope}` : tool.id === 'ruff' ? `check --fix ${scope}` : `lint --write ${scope}`;
            const r = await runTool(host, tool, args, signal);
            return r && ran('lint.fix', `${tool.id}: applied the automatic fixes`, r, { tool: tool.id });
        },
    };
}

export function formatApply(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, 'formatter');
            if (!tool) return undefined;
            const files = focusArgs(host, (p) => (tool.id === 'black' ? PY.test(p) : JS_TS.test(p)));
            const scope = files.length ? files.join(' ') : '.';
            const args = tool.id === 'prettier' ? `--write ${scope}` : tool.id === 'biome' ? `format --write ${scope}` : scope;
            const r = await runTool(host, tool, args, signal);
            return r && ran('format.apply', `${tool.id}: formatted ${files.length ? `${files.length} file(s)` : 'the workspace'}`, r, { tool: tool.id });
        },
    };
}

/** `plop <generator> <names…>` — plop's positional bypass, every word checked. */
export function scaffoldPlop(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(request, signal) {
            const words = slashArgs(request, '/plop').replace(/^plop\s+/i, '').split(/\s+/).filter(Boolean);
            if (words.length === 0 || !words.every((w) => WORD.test(w))) return undefined;
            const r = await runTool(host, toolOf(host, 'plop'), words.join(' '), signal);
            return r && ran('scaffold.plop', `plop ${words[0]}`, r, { generator: words[0] });
        },
    };
}

/** `hygen <generator> <action> [name]`. */
export function scaffoldHygen(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(request, signal) {
            const words = slashArgs(request, '/hygen').replace(/^hygen\s+/i, '').split(/\s+/).filter(Boolean);
            if (words.length < 2 || !words.every((w) => WORD.test(w))) return undefined;
            const [generator, action, name] = words;
            const r = await runTool(host, toolOf(host, 'hygen'), `${generator} ${action}${name ? ` --name ${name}` : ''}`, signal);
            return r && ran('scaffold.hygen', `hygen ${generator} ${action}`, r, { generator });
        },
    };
}

/** A starter scaffold (`@builderforce/ide-templates`), written file by file — never over an existing file. */
export function scaffoldTemplate(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(request, signal) {
            const templates = host.templates;
            const write = host.caps.repoWrite;
            const read = host.caps.repoRead;
            if (!templates || !write || !read) return undefined;
            const asked = slashArgs(request, '/scaffold').split(/\s+/).find((w) => WORD.test(w) && templates[w.toLowerCase()]);
            const name = asked?.toLowerCase() ?? (Object.keys(templates).length === 1 ? Object.keys(templates)[0] : undefined);
            const files = name ? templates[name] : undefined;
            if (!name || !files) return undefined;
            const written: string[] = [];
            const kept: string[] = [];
            for (const [path, content] of Object.entries(files)) {
                if (signal.aborted) return undefined;
                const existing = await read.readFile(path).catch(() => undefined);
                if (existing?.ok) {
                    kept.push(path);
                    continue;
                }
                const w = await write.writeFile(path, content, `PreFetch: the ${name} starter`);
                if (w.ok) written.push(path);
            }
            const text = [`Scaffolded the **${name}** starter: ${written.length} file(s) written${kept.length ? `, ${kept.length} kept as they were` : ''}.`, '',
                ...written.map((p) => `- \`${p}\``)].join('\n');
            return { actionId: 'scaffold.template', text, data: { template: name, written: written.length, kept: kept.length } };
        },
    };
}

/** One code generator, run with its own project config. */
function codegen(host: PrefetchExecHost, actionId: string, toolId: string, args: (concrete: string) => string): PrefetchRunner {
    return {
        async run(_request, signal) {
            const tool = toolOf(host, toolId);
            if (!tool) return undefined;
            const r = await runTool(host, tool, args(tool.id), signal);
            return r && ran(actionId, `${tool.id}: generated`, r, { tool: tool.id });
        },
    };
}

/** `pattern => rewrite` (or `->`), with an optional `--lang x`. */
export function parseCodemod(text: string): { pattern: string; rewrite: string; language: string } | undefined {
    let body = text.replace(/^(ast-grep|sg)\s+(run|scan)\s+/i, '').trim();
    let language = 'TypeScript';
    const lang = /\s--lang\s+([\w-]+)\s*$/i.exec(body);
    if (lang) {
        language = lang[1]!;
        body = body.slice(0, lang.index).trim();
    }
    const m = /^(?:rewrite\s+(?:every\s+)?)?(.+?)\s*(?:=>|->|\bto\b)\s*(.+)$/i.exec(body);
    if (!m) return undefined;
    const strip = (s: string): string => s.trim().replace(/^`([\s\S]*)`$/, '$1').trim();
    const pattern = strip(m[1]!), rewrite = strip(m[2]!);
    return pattern && rewrite ? { pattern, rewrite, language } : undefined;
}

/** ast-grep over the workspace with a one-rule file — the pattern never touches the command line. */
export function codemodPattern(host: PrefetchExecHost): PrefetchRunner {
    return {
        async run(request, signal) {
            const tool = toolOf(host, 'ast-grep');
            const write = host.caps.repoWrite;
            const mod = parseCodemod(slashArgs(request, '/codemod'));
            if (!tool || !write || !mod || !WORD.test(mod.language)) return undefined;
            const rulePath = `${PREFETCH_SCRATCH_DIR}/codemod-rule.yml`;
            // JSON strings are valid YAML scalars: quoting is exact whatever the pattern holds.
            const rule = [`id: prefetch-codemod`, `language: ${mod.language}`, 'rule:', `  pattern: ${JSON.stringify(mod.pattern)}`, `fix: ${JSON.stringify(mod.rewrite)}`, ''].join('\n');
            await write.writeFile(rulePath, rule, 'PreFetch: codemod rule');
            const r = await runTool(host, tool, `scan --rule ${rulePath} --update-all .`, signal);
            return r && ran('codemod.pattern', `ast-grep: ${mod.pattern} → ${mod.rewrite}`, r, { language: mod.language });
        },
    };
}

/** The write executors, by action id. */
export function writeExecutors(host: PrefetchExecHost): Record<string, PrefetchRunner> {
    return {
        'lint.fix': lintFix(host),
        'format.apply': formatApply(host),
        'scaffold.plop': scaffoldPlop(host),
        'scaffold.hygen': scaffoldHygen(host),
        'scaffold.template': scaffoldTemplate(host),
        'codegen.openapi': codegen(host, 'codegen.openapi', 'openapi-codegen', (id) => (id === 'orval' ? '' : 'generate')),
        'codegen.prisma': codegen(host, 'codegen.prisma', 'prisma', () => 'generate'),
        'codegen.graphql': codegen(host, 'codegen.graphql', 'graphql-codegen', () => ''),
        'codemod.pattern': codemodPattern(host),
    };
}
