/**
 * The live preview's dev server as a process this container can SEE and RESTART
 * (PRD 31 §W1 item 8: `preview_logs`, `preview_restart`).
 *
 * The dev server used to be spawned with its output discarded, so a preview that broke
 * after an edit gave the agent nothing to read and no way to bring it back short of a
 * new run. Here its stdout and stderr go to a BOUNDED ring buffer (whole lines, each
 * capped, the oldest dropped first), and a restart kills its process group and starts
 * the same command again in the same place.
 *
 * Spawn and kill are injected (`spawnShell` / `killSandboxTree` in the image), so this is
 * testable without a shell user, a container or Linux.
 */

/** Lines kept per preview, and the longest line kept (a minified bundle in an error is not a log line). */
export const PREVIEW_LOG_LINES = 1000;
export const PREVIEW_LOG_LINE_CHARS = 2000;

/** A ring of whole lines fed by arbitrary chunks. */
export function createLogRing({ maxLines = PREVIEW_LOG_LINES, maxLineChars = PREVIEW_LOG_LINE_CHARS } = {}) {
  const lines = [];
  let partial = '';
  const keep = (line) => {
    lines.push(line.length > maxLineChars ? `${line.slice(0, maxLineChars)}…` : line);
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
  };
  return {
    push(chunk) {
      const text = partial + String(chunk);
      const parts = text.split(/\r?\n/);
      partial = parts.pop() ?? '';
      if (partial.length > maxLineChars) { keep(partial); partial = ''; }
      for (const line of parts) keep(line);
    },
    /** The last `n` lines, the unterminated one included. */
    tail(n) {
      const all = partial ? [...lines, partial] : lines.slice();
      return all.slice(-Math.max(0, n));
    },
  };
}

/**
 * The dev server process. `start()` spawns it (piped, detached — it leads its own process
 * group); `restart()` kills that group and spawns again; `exitCode()` is null while it runs.
 */
export function createPreviewProcess({ command, cwd, extraEnv, spawn, kill, ring = createLogRing() }) {
  let child = null;
  let exit = null;
  let generation = 0;

  const start = () => {
    const mine = ++generation;
    exit = null;
    child = spawn(command, { cwd, extraEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (data) => ring.push(data));
    child.stderr?.on('data', (data) => ring.push(data));
    // A superseded child (killed by a restart) must not report over its successor.
    child.on('exit', (code, signal) => {
      if (mine !== generation) return;
      exit = code ?? signal ?? 'exited';
      ring.push(`\n[builderforce] the dev server exited (${exit})\n`);
    });
    child.on('error', (error) => {
      if (mine !== generation) return;
      exit = error.message;
      ring.push(`\n[builderforce] the dev server could not start: ${error.message}\n`);
    });
    child.unref?.();
    return child;
  };

  return {
    command,
    start,
    restart() {
      if (child && exit === null) kill(child);
      ring.push(`\n[builderforce] restarting the dev server: ${command}\n`);
      return start();
    },
    exitCode: () => exit,
    running: () => child !== null && exit === null,
    tail: (n) => ring.tail(n),
  };
}
