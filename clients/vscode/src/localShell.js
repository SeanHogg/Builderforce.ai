/**
 * The editor's ONE local shell runner — what `run_command` and the `git_*` tools run
 * through (via `localCapabilities.ts`) and what the workspace's `.builderforce/hooks.json`
 * commands run through (via `hooks/runHooks.ts`). One runner, so a hook command and an
 * agent's command behave identically: the same POSIX-script routing on Windows, the same
 * timeout and output bound, the same result shape.
 *
 * A pipeline runs under `pipefail` (`withPipefail`), so a failing stage is not exit 0. Within
 * a run (a `jobOwner`) the shell also keeps each command's FULL output for `output_filter`
 * (`localShellOutputs.ts`) and hands back the earlier result of an unchanged verification
 * command (`localShellCache.ts`).
 */
import * as path from "path";
import { posixRoute, runRouted, withPipefail } from "@builderforce/agent-tools/node-posix-shell";
import { resolveShellCwd } from "@builderforce/agent-tools/node-path";
import { spawnCommand, stopCommand } from "./processTree";
import { killJob, pollJob, startJob } from "./localShellJobs";
import { readOutput, retainOutput } from "./localShellOutputs";
import { cachedResult, invalidateRunCache, rememberResult, shellCacheEffect, workspaceFingerprint } from "./localShellCache";
// Bound a command's wall-clock + the output handed back to the model. Matches the cloud
// Container's COMMAND_TIMEOUT_MS (api/container/server.mjs) — a build/type-check/test
// step may legitimately take minutes (e.g. `tsc --noEmit` or `npm test` on a large
// monorepo), and the old 120s ceiling was killing those runs mid-compile well before
// they could finish.
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_MAX_BUFFER = 4 * 1024 * 1024;
const RUN_MAX_OUTPUT = 60_000;
/** Within a run the full text stays retained under the result's `outputId` (`output_filter`). */
function clamp(text, max) {
    return text.length <= max ? text : `${text.slice(0, max)}\n…(${text.length - max} more chars truncated)`;
}
/**
 * Wait for `child` to exit. Never rejects. A stream past {@link RUN_MAX_BUFFER} calls
 * `onOverflow` once and keeps no more: an unbounded producer (`yes`, `tail -f`, a
 * watcher run in the foreground) is stopped there, not left to the 10-minute bound.
 */
function collect(child, onOverflow) {
    return new Promise((resolve) => {
        const out = { stdout: "", stderr: "" };
        let overflowed = false;
        for (const key of ["stdout", "stderr"]) {
            child[key]?.on("data", (chunk) => {
                if (out[key].length < RUN_MAX_BUFFER)
                    out[key] += chunk;
                else if (!overflowed) {
                    overflowed = true;
                    onOverflow();
                }
            });
        }
        let error;
        child.on("error", (e) => {
            error = e;
            // A child that never started emits no `close`.
            if (child.pid === undefined)
                resolve({ ...out, code: null, signal: null, error: e });
        });
        child.on("close", (code, signal) => resolve({ ...out, code, signal, ...(error ? { error } : {}) }));
    });
}
const aborted = (out) => ({
    ok: false,
    aborted: true,
    error: "stopped — the command and everything it started were killed",
    ...(out ? { stdout: clamp(out, RUN_MAX_OUTPUT) } : {}),
});
/** A shell rooted at `root` (every command's working directory). `jobOwner` is the run
 *  its background jobs belong to (see `localShellJobs.ts`). */
export function createLocalShell(root, opts = {}) {
    const cwd = path.resolve(root);
    const owner = opts.jobOwner;
    /** Execute once, in a named interpreter. `bash` null ⇒ the platform default shell. */
    async function execOnce(command, bash, options, dir) {
        const timeout = options.timeoutMs ?? RUN_TIMEOUT_MS;
        const signal = options.signal;
        if (signal?.aborted)
            return aborted("");
        // A POSIX script goes to bash EXPLICITLY (`bash -c <script>`), not through the
        // platform shell with an override: the one thing that must not vary between
        // machines is which interpreter parses `set -e`. A one-liner keeps the default.
        // `spawnCommand` puts it in its own process group, so Stop can kill the group.
        let child;
        try {
            child = spawnCommand(withPipefail(command, bash, process.platform), bash, { cwd: dir, ...(options.env ? { env: { ...process.env, ...options.env } } : {}) });
        }
        catch (e) {
            return { ok: false, exitCode: 1, stdout: e instanceof Error ? e.message : String(e) };
        }
        let overflowed = false;
        const exited = collect(child, () => {
            overflowed = true;
            stopCommand(child);
        });
        // Stop kills the TREE, never just the shell: that orphans the real process — on
        // Windows before `taskkill /T` can walk to it (see `processTree.ts`).
        const onAbort = () => stopCommand(child);
        // The wall-clock bound kills the TREE too, for the same reason.
        let timedOut = false;
        const onTimeout = setTimeout(() => {
            timedOut = true;
            stopCommand(child);
        }, timeout);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            const r = await exited;
            const out = [r.stdout, r.stderr].filter((s) => s.trim()).join("\n").trim();
            const settled = (() => {
                if (signal?.aborted)
                    return aborted(out);
                if (overflowed) {
                    return { ok: false, error: `stopped — it printed more than ${RUN_MAX_BUFFER / (1024 * 1024)}MB of output`, stdout: clamp(out, RUN_MAX_OUTPUT) };
                }
                if (r.code === 0 && !r.error)
                    return { ok: true, exitCode: 0, stdout: clamp(out || "(no output)", RUN_MAX_OUTPUT) };
                if (timedOut || r.signal === "SIGTERM") {
                    return { ok: false, error: `timed out after ${timeout / 1000}s`, stdout: clamp(out, RUN_MAX_OUTPUT) };
                }
                return { ok: false, exitCode: r.code ?? 1, stdout: clamp(out || r.error?.message || "(no output)", RUN_MAX_OUTPUT) };
            })();
            // Within a run, the FULL output is kept for `output_filter`, and the result says where.
            return owner !== undefined && out ? { ...settled, outputId: retainOutput(owner, out) } : settled;
        }
        finally {
            clearTimeout(onTimeout);
            signal?.removeEventListener("abort", onAbort);
        }
    }
    return {
        async run(command, options = {}) {
            const where = resolveShellCwd(cwd, options.cwd);
            if (!where.ok)
                return { ok: false, error: where.error };
            // Which interpreter, and the one cmd→bash retry, are THE shared routing rule.
            const exec = () => runRouted(command, (bash) => execOnce(command, bash, options, where.dir), options.signal);
            // Only a run's verification commands are cached; a read-only one leaves the cache alone, one that may write drops it.
            const effect = owner === undefined ? "keep" : shellCacheEffect(command);
            if (owner === undefined || effect !== "cache") {
                const r = await exec();
                if (owner !== undefined && effect === "drop")
                    invalidateRunCache(owner);
                return r;
            }
            if (!options.fresh) {
                const hit = await cachedResult(owner, where.dir, command);
                if (hit)
                    return hit;
            }
            const startedAt = new Date();
            const before = workspaceFingerprint(where.dir);
            const r = await exec();
            await rememberResult(owner, where.dir, command, r, before, startedAt);
            return r;
        },
        async start(command, options = {}) {
            const route = posixRoute(command);
            if ("error" in route)
                return { ok: false, error: route.error };
            const where = resolveShellCwd(cwd, options.cwd);
            if (!where.ok)
                return { ok: false, error: where.error };
            // A background job may write at any time: the run's cached results are no longer safe.
            if (owner !== undefined)
                invalidateRunCache(owner);
            return startJob(withPipefail(command, route.bash, process.platform), {
                cwd: where.dir,
                bash: route.bash,
                maxOutput: RUN_MAX_OUTPUT,
                ...(owner !== undefined ? { owner } : {}),
                ...(options.env ? { env: options.env } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            });
        },
        poll: (id, poll) => pollJob(id, poll?.waitMs ?? 0, { owner, ...(poll?.signal ? { signal: poll.signal } : {}) }),
        kill: (id) => killJob(id, owner),
        output: async (outputId) => readOutput(owner, outputId),
    };
}
//# sourceMappingURL=localShell.js.map