/**
 * Runs a shell command for the knowledge fix flow (knip's codemod, a project's check script) and
 * keeps the host safe while it does:
 *
 *   - the whole PROCESS TREE dies on timeout or abort (`taskkill /T /F` on Windows, the process
 *     group elsewhere), so a script's grandchildren never outlive the check;
 *   - only the LAST 64 KB of output is kept, ANSI stripped, and what is reported back is capped
 *     at 2 KB;
 *   - `BUILDERFORCE_*` variables are not passed to the child;
 *   - a command that ran and failed (`kind: "exit"`) is told apart from one that could not run.
 */
import { spawn } from "node:child_process";
import { killTree } from "../process/killTree";
import { fixText } from "./knowledgeFixText";
export const OUTPUT_TAIL = 64 * 1024;
export const DETAIL_CAP = 2 * 1024;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
/** Output without terminal colour and cursor codes. Pure. */
export const stripAnsi = (text) => text.replace(ANSI, "");
/** The environment a child gets: ours, minus every `BUILDERFORCE_*` variable. Pure. */
export function childEnv(env) {
    return Object.fromEntries(Object.entries(env).filter(([k]) => !k.toUpperCase().startsWith("BUILDERFORCE_")));
}
/** The last `cap` characters of `text + chunk`. Pure. */
export const tailOf = (text, chunk, cap = OUTPUT_TAIL) => (text.length + chunk.length <= cap ? text + chunk : (text + chunk).slice(-cap));
/** A command that did not succeed, and why. `output` is the cleaned tail, at most {@link DETAIL_CAP}. */
export class ShellFailure extends Error {
    kind;
    output;
    code;
    constructor(kind, message, output = "", code = null) {
        super(message);
        this.kind = kind;
        this.output = output;
        this.code = code;
        this.name = "ShellFailure";
    }
}
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const clean = (text) => stripAnsi(text).trim().slice(-DETAIL_CAP);
/** Runs `command` through the shell; rejects with a {@link ShellFailure} unless `ok` (default: knip ran). */
export function runShell(command, cwd, opts) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const label = opts.label ?? "knip";
    return new Promise((resolve, reject) => {
        if (opts.signal?.aborted) {
            reject(new ShellFailure("aborted", fixText.cancelled(label)));
            return;
        }
        const windows = process.platform === "win32";
        const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"], env: childEnv(process.env) });
        let stdout = "";
        let stderr = "";
        let end;
        child.stdout.on("data", (c) => { stdout = tailOf(stdout, c.toString("utf8")); });
        child.stderr.on("data", (c) => { stderr = tailOf(stderr, c.toString("utf8")); });
        const stop = (failure) => {
            end ??= failure;
            if (child.pid === undefined)
                return; // never started: nothing to kill
            killTree(child.pid);
        };
        const timer = setTimeout(() => stop(new ShellFailure("timeout", fixText.timedOut(label, Math.round(timeoutMs / 1000)))), timeoutMs);
        const onAbort = () => stop(new ShellFailure("aborted", fixText.cancelled(label)));
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        const done = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); };
        child.on("error", (error) => { done(); reject(new ShellFailure("launch", fixText.couldNotRun(label, error.message))); });
        child.on("close", (code) => {
            done();
            if (end) {
                reject(new ShellFailure(end.kind, end.message, clean(`${stdout}\n${stderr}`), code));
                return;
            }
            if (opts.ok(code, stdout, stderr)) {
                resolve();
                return;
            }
            reject(new ShellFailure("exit", fixText.failedExit(label, String(code)), clean(stderr || stdout), code));
        });
    });
}
//# sourceMappingURL=knowledgeShell.js.map