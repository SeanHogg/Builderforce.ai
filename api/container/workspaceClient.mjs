/**
 * The sandbox server's handle on the WORKSPACE AGENT (`workspaceAgent.mjs`): the one process that reads,
 * writes, lists and runs git inside the run's working tree, as the shell user. This client spawns it ONCE
 * per sandbox (lazily, on the first request) through `spawnShell` — the same `sudo -n -u <user> env -i …`
 * path every model shell takes — and speaks newline-delimited JSON with it. Nothing else in the server
 * touches the workspace.
 *
 * Plain ESM, node builtins and `sandboxJobs.mjs` only (the Actions runner inlines it).
 */
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { killTree, spawnShell } from './sandboxJobs.mjs';

/** A helper reply line past this is refused (the helper is the model's user: its output is not trusted to be small). */
const MAX_REPLY_LINE_CHARS = 64 * 1024 * 1024;

/** POSIX single-quote a word for the `bash -lc` line that starts the helper. */
function quote(word) {
  return `'${String(word).replace(/'/g, `'\\''`)}'`;
}

/**
 * `helperPath` is the helper script (a file the server owns and the shell user can read but not change).
 * `call(req)` answers `{ ok, ... }` — a dead helper answers `{ ok: false, error }` and is started afresh by
 * the next call.
 */
export function createWorkspaceClient({ workdir, helperPath }) {
  let child = null;
  let seq = 0;
  const pending = new Map();

  function failAll(message) {
    for (const settle of pending.values()) settle({ ok: false, error: message });
    pending.clear();
  }

  function start() {
    // The workdir may not exist yet (the helper's `init` makes it): start somewhere that always does.
    const proc = spawnShell(`exec ${quote(process.execPath)} ${quote(helperPath)} ${quote(workdir)}`, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    // The helper's stderr is the MODEL's to influence (it runs as the shell user): never inherited, since a line starting
    // `::` on the runner's own stderr is an Actions workflow command (`::add-mask::`, `::set-env`…). Every line gets a fixed prefix.
    createInterface({ input: proc.stderr }).on('line', (line) => console.error(`[workspace] ${line.replace(/[\r\0]/g, '')}`.slice(0, 2000)));
    proc.stderr.on('error', () => { /* the helper ended */ });
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let reply;
      if (line.length > MAX_REPLY_LINE_CHARS) { failAll(`the workspace helper's reply was over the ${MAX_REPLY_LINE_CHARS}-character limit`); return; }
      try { reply = JSON.parse(line); } catch (e) { console.error(`[workspace] unparseable reply: ${e.message}`); return; }
      const settle = pending.get(reply.id);
      if (!settle) return;
      pending.delete(reply.id);
      const { id: _id, ...rest } = reply;
      settle(rest);
    });
    proc.stdin.on('error', (e) => console.error(`[workspace] helper stdin: ${e.message}`));
    proc.on('error', (e) => { if (child === proc) child = null; failAll(`the workspace helper could not start: ${e.message}`); });
    proc.on('exit', (code) => { if (child === proc) child = null; failAll(`the workspace helper exited (${code})`); });
    return proc;
  }

  return {
    call(req) {
      const proc = child ?? start();
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        proc.stdin.write(`${JSON.stringify({ ...req, id })}\n`, (e) => {
          if (e && pending.delete(id)) resolve({ ok: false, error: `the workspace helper is unreachable: ${e.message}` });
        });
      });
    },
    /** End the helper (and anything it started). Idempotent. */
    close() {
      const proc = child;
      child = null;
      if (!proc) return;
      try { proc.stdin.end(); } catch (e) { console.error(`[workspace] could not close the helper's stdin: ${e.message}`); }
      killTree(proc);
    },
  };
}
