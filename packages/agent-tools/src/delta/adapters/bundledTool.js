/**
 * delta/adapters/bundledTool.ts — one run of a BUNDLED analyzer (dependency-cruiser, jscpd, knip; PRD 41 A3) on one
 * side's tree, with the pinned invocation the codebase analysis uses (`codeAnalysisTool.ts` `ANALYZERS`), its
 * artifacts redirected to a scratch directory instead of the tree. Never `npm exec`: a tool the host has no entry for
 * is `skipped` (`analyzer-unavailable` / `tool-absent`).
 */
import { ANALYZERS, parseAnalyzerJson } from '../../codeAnalysisTool.js';
import { ANALYZER_TIMEOUT_MS, bundledArgv, cutShort, failed, missingReason, runFailure, skipped, } from './analyzer.js';
const ARTIFACTS = '.builderforce/code-analysis';
/**
 * Runs the pinned tool over the side's tree. `prepare` writes inputs into the scratch directory first (the
 * dependency-cruiser config); `reportFile` names a report the tool writes there instead of stdout (jscpd).
 */
export async function runBundled(name, side, exec, signal, opts = {}) {
    const spec = ANALYZERS.find((a) => a.name === name);
    const scratch = await exec.tempDir();
    try {
        const base = spec.args.split(' ').map((a) => a.replace('{scope}', '.').replace(ARTIFACTS, scratch.path));
        const argv = bundledArgv(side, name, opts.args ? opts.args(base) : base);
        if (!argv)
            return skipped(name, missingReason(side), spec.version);
        await opts.prepare?.(scratch.path);
        const r = await exec.run(argv, { cwd: side.dir, timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
        if (!r.started)
            return skipped(name, 'analyzer-unavailable', spec.version);
        if (cutShort(r))
            return failed(name, runFailure(r), spec.version);
        const text = opts.reportFile ? await exec.readText(`${scratch.path}/${opts.reportFile}`) : r.stdout;
        if (!text)
            return failed(name, 'exit-failed', spec.version);
        try {
            const report = parseAnalyzerJson(text);
            if (!report || typeof report !== 'object')
                return failed(name, 'invalid-report', spec.version);
            return { version: spec.version, report: report };
        }
        catch {
            return failed(name, 'invalid-report', spec.version);
        }
    }
    finally {
        void scratch.dispose().catch(() => undefined);
    }
}
export const isRunResult = (v) => 'status' in v;
//# sourceMappingURL=bundledTool.js.map