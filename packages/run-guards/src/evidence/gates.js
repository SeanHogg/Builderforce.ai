/**
 * Gate decisions (PRD 45 §4.3) — the pure half of the deterministic run gates.
 *
 * Every gate takes facts and returns a {@link GateVerdict}; none does I/O. The gates
 * trust only what is in the {@link EvidenceLedger}, and the ledger is keyed by the
 * bytes on disk — so evidence the model *claims* in its output can never satisfy a
 * gate. A line in a model's transcript such as
 *
 *     npx tsc | grep error | head -20; echo DONE
 *
 * never reaches this module: no host code parses model output into CheckRecords.
 * Even a forged record is useless, because the gate looks evidence up by the hash of
 * the file's real bytes at gate time (`OutgoingFile.hash`, computed by the host from
 * the file itself), and the model does not control that hash. A `tsc | grep | head`
 * pipe also hides the real exit code behind `head`'s — which is exactly why the host
 * captures process exit codes itself and why a record without a host-captured hash
 * match counts for nothing here.
 *
 * A required check passes when its `outcome` is "pass". "unavailable" passes AND is
 * reported in the verdict's `unavailable` list (OD-3: shown in the approval prompt,
 * never reported as verified). "fail" refuses. A diagnostics record additionally
 * fails on any `error`-severity finding for the file, even when its outcome says
 * pass — the LSP is the source of truth there, not the exit code.
 *
 * `outgoingGate` is THE ship gate: it fires at `git_commit` (advisory), `git_push`
 * and `open_pull_request` (refusal), and ticket completion (via the host). A file
 * changed by `run_command`, a sub-agent, or the human in the editor is handled
 * identically — the host re-hashes the bytes and the gate asks for evidence against
 * the new hash. Deleted paths need no checks of their own; the owning package's
 * typecheck covers what imported them (PRD §4.2).
 */
import { isTestPath } from "../noProgress.js";
import { gitCommandPattern } from "./gitCommandPattern.js";
import { normalizeEvidencePath, } from "./ledger.js";
/** The default VSIX policy: .ts/.tsx need diagnostics + typecheck + test evidence. */
export const DEFAULT_EVIDENCE_POLICY = {
    required: {
        ".ts": ["diagnostics", "typecheck", "test"],
        ".tsx": ["diagnostics", "typecheck", "test"],
        ".mts": ["diagnostics", "typecheck", "test"],
        ".cts": ["diagnostics", "typecheck", "test"],
        ".js": ["typecheck", "test"],
        ".jsx": ["typecheck", "test"],
        ".mjs": ["typecheck", "test"],
        ".cjs": ["typecheck", "test"],
    },
    newSourceNeedsTest: true,
    newSourceTestExempt: [
        // Barrels / re-export entry points.
        "(^|/)index\\.[cm]?[jt]sx?$",
        // Type-only modules and declarations.
        "(^|/)types\\.[cm]?tsx?$",
        "\\.d\\.[cm]?ts$",
        // Tool / build configuration.
        "\\.config\\.[cm]?[jt]s$",
        // Node scripts.
        "\\.[cm]js$",
        // Label / copy catalogs.
        "(^|/)labels?/",
        "(^|/)[^/]*(labels?|catalog)(\\.[^/]*)?\\.[cm]?[jt]sx?$",
        // Fixtures and test helpers.
        "(^|/)(__fixtures__|fixtures?|__mocks__|test-?utils|test-?helpers|testing)/",
        "\\.(fixtures?|mocks?|helpers?)\\.[cm]?[jt]sx?$",
        "(^|/)(test|spec)[-_.]?(helpers?|utils?|setup)\\.[cm]?[jt]sx?$",
        "(^|/)(setupTests|vitest\\.setup|jest\\.setup)\\.[cm]?[jt]sx?$",
    ],
    newSourceTestCoverage: ["stem", "directory", "import"],
    checkTimeoutMs: 120_000,
};
function basenameOf(path) {
    const normalized = normalizeEvidencePath(path);
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function extOf(path) {
    const base = basenameOf(path);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot).toLowerCase() : "";
}
function stemOf(path) {
    const base = basenameOf(path);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
}
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
function isSourceFile(path) {
    return SOURCE_EXTENSIONS.has(extOf(path));
}
function dirOf(path) {
    const normalized = normalizeEvidencePath(path);
    const slash = normalized.lastIndexOf("/");
    return slash >= 0 ? normalized.slice(0, slash) : "";
}
/** A path without its JS/TS extension — imports name modules without one (or with `.js`). */
function moduleKey(path) {
    return normalizeEvidencePath(path).replace(/\.[cm]?[jt]sx?$/i, "");
}
function isExemptFromTestRule(path, policy) {
    const normalized = normalizeEvidencePath(path);
    return (policy.newSourceTestExempt ?? []).some((source) => new RegExp(source, "i").test(normalized));
}
/** Does the policy's new-source rule demand a test for this file? (A new test file IS its own test.) */
function needsTest(file, policy) {
    return (!!policy.newSourceNeedsTest &&
        file.isNew &&
        isSourceFile(file.absPath) &&
        !isTestPath(file.absPath) &&
        !isExemptFromTestRule(file.absPath, policy));
}
/** Does `test` (a test file in the push) count as `file`'s test under the policy? */
function covers(test, file, policy) {
    const coverage = policy.newSourceTestCoverage ?? ["stem"];
    if (coverage.includes("stem") && basenameOf(test.absPath).startsWith(stemOf(file.absPath) + "."))
        return true;
    if (coverage.includes("directory")) {
        const dir = dirOf(file.absPath);
        if (dirOf(test.absPath) === dir)
            return true;
        // A test named after the directory, beside it: `detectors.write.test.ts` next to `detectors/`.
        const dirName = dir.slice(dir.lastIndexOf("/") + 1);
        if (dirName && dirOf(test.absPath) === dirOf(dir) && basenameOf(test.absPath).startsWith(dirName + "."))
            return true;
    }
    if (coverage.includes("import") && test.imports?.length) {
        const target = moduleKey(file.absPath);
        if (test.imports.some((i) => moduleKey(i) === target))
            return true;
    }
    return false;
}
/** Findings are "path:line:col severity message (code)" — severity is the 2nd token. */
function isErrorFinding(finding) {
    const tokens = finding.trim().split(/\s+/);
    return (tokens[1] ?? "").toLowerCase() === "error";
}
function pass() {
    return { ok: true, unavailable: [] };
}
function refuse(reason) {
    return { ok: false, reason };
}
/**
 * A file NO policy check could ever fail: its extension maps to no required check and it is
 * not a new source file needing a test — docs, copy, images, and any deleted path. The host
 * asks this when the outgoing set cannot be computed: a change made only of such files is
 * CLEAR rather than unverifiable, because the identical files pass this same rule with zero
 * checks once an upstream exists (a docs-only ticket can close on a branchless checkout).
 */
export function fileIsUnchecked(file, policy) {
    if (file.deleted)
        return true;
    if ((policy.required[extOf(file.absPath)] ?? []).length > 0)
        return false;
    return !needsTest(file, policy);
}
/** First findings of a failing check, capped for the refusal text. */
function firstFindings(check, max = 3) {
    const shown = check.findings.slice(0, max);
    const more = check.findings.length > max ? ` (+${check.findings.length - max} more)` : "";
    return shown.length ? shown.join("; ") + more : "(no findings recorded)";
}
function checkFailureReason(path, check, detail) {
    const tail = check.outputTail?.trim();
    return (`git_push refused: ${path} failed ${check.kind} "${check.name}"${detail}. ` +
        `First findings: ${firstFindings(check)}.` +
        (tail ? ` Output (tail): ${tail.replace(/\s+/g, ' ').trim().slice(0, 400)}.` : "") +
        ` Fix the failure and push again — the host runs the checks.`);
}
/**
 * The push / pull-request gate — the real done gate (tickets close after a
 * verified push). One refusal shape for every failure, naming the file, the
 * failing check and its first findings, and what to do (PRD §4.3).
 */
export function outgoingGate(files, ledger, policy) {
    const unavailable = [];
    for (const file of files) {
        if (file.deleted)
            continue;
        const checks = ledger.for(file.absPath, file.hash);
        // The host could not check the pushed bytes: reported, never passed on other bytes' evidence.
        const required = file.unavailable ? [] : policy.required[extOf(file.absPath)] ?? [];
        if (file.unavailable)
            unavailable.push(`${file.absPath}: ${file.unavailable}`);
        for (const kind of required) {
            const records = checks.filter((c) => c.kind === kind);
            if (records.length === 0) {
                // No record at all: the verifier never covered this file for this hash.
                // OD-3 — pass but report, exactly like an "unavailable" outcome.
                unavailable.push(`${file.absPath}: ${kind} (no record — verifier unavailable)`);
                continue;
            }
            // The LATEST record of a kind is the evidence for these bytes: a transient
            // failure (a check that raced a rebuild or an unsettled environment) which a
            // fresh passing run already superseded must not refuse the push forever.
            const record = records.reduce((a, b) => (b.at >= a.at ? b : a));
            if (record.outcome === "fail") {
                const detail = record.exitCode != null ? ` (exit ${record.exitCode})` : "";
                return refuse(checkFailureReason(file.absPath, record, detail));
            }
            if (record.outcome === "unavailable") {
                unavailable.push(`${file.absPath}: ${record.name} (${kind}) unavailable`);
            }
            if (kind === "diagnostics") {
                // The LSP outranks the exit code: an error-severity finding on this file
                // fails the check even when the record's outcome says pass.
                if (record.findings.some(isErrorFinding))
                    return refuse(checkFailureReason(file.absPath, record, " (LSP error)"));
            }
        }
        // A new test file IS its own test — it does not need a test named after it.
        if (needsTest(file, policy)) {
            const stem = stemOf(file.absPath);
            const hasTest = files.some((t) => t !== file && !t.deleted && isTestPath(t.absPath) && covers(t, file, policy));
            if (!hasTest) {
                return refuse(`git_push refused: ${file.absPath} is new and has no test in this push. ` +
                    `Add ${stem}.test.ts covering it, commit, and push again — the host runs the checks.`);
            }
        }
    }
    return unavailable.length ? { ok: true, unavailable } : pass();
}
/**
 * OD-1. Refuses when there is no review, the reviewer is one of the author models,
 * the verdict is changes_requested (findings become the reason), or the diff changed
 * after the review was recorded.
 */
export function reviewGate(review, authorModels, currentDiffHash) {
    if (!review) {
        return refuse("git_push refused: no independent review. The push gate requires one review sub-run " +
            "by a model that did not author the change (PRD 45 OD-1); record it with the reviewer port, then push again.");
    }
    if (authorModels.includes(review.reviewerModel)) {
        return refuse(`git_push refused: reviewer ${review.reviewerModel} is one of the author models ` +
            `(${authorModels.join(", ")}). Run the review on a different model and push again.`);
    }
    if (review.diffHash !== currentDiffHash) {
        return refuse("git_push refused: the diff changed after the review was recorded. Re-run the review " +
            "on the current diff and push again.");
    }
    if (review.verdict === "changes_requested") {
        return refuse(`git_push refused: reviewer ${review.reviewerModel} requested changes. Findings: ` +
            `${review.findings.slice(0, 5).join("; ") || "(none recorded)"}. Address them and push again.`);
    }
    return pass();
}
/**
 * §4.5: an advisory (never a refusal) for `run_command` that publishes straight from
 * the shell. Returns null for anything that is not a git commit/push — the outgoing
 * gate is what actually catches shell commits, because it reads the real commits.
 */
export function shellPublishHint(command) {
    if (!gitCommandPattern("commit|push").test(command))
        return null;
    return ("That shell command publishes. Use the git_commit / git_push tools instead: git_push runs " +
        "the evidence gates and the independent review before the push leaves the machine.");
}
//# sourceMappingURL=gates.js.map