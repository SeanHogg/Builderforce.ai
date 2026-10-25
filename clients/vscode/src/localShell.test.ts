/**
 * Stop reaches the process (PRD 35 E10): aborting a command's signal kills the command
 * AND what its shell started — on Windows `cmd.exe` would otherwise die alone and leave
 * `node` running to its 10-minute timeout — and the result says it was stopped. Plus the
 * background jobs `run_command` `background` / `yieldMs` run on (E6).
 */

import * as os from "os";
import { describe, expect, it } from "vitest";
import { createLocalShell } from "./localShell";

/** A child that would run for 10 minutes, printing its own pid first. */
const LONG_CHILD = 'node -e "console.log(process.pid);setTimeout(()=>{},600000)"';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

describe("localShell Stop", () => {
  it("kills a long-running child (the whole tree) within 2s of the abort", async () => {
    const shell = createLocalShell(os.tmpdir());
    const ac = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ac.abort(), 800);
    const r = await shell.run(LONG_CHILD, { signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(2_800);
    expect(r.ok).toBe(false);
    expect(r.aborted).toBe(true);
    // The grandchild (the real `node`, not the shell that started it) is gone too.
    const pid = Number(/\d+/.exec(r.stdout ?? "")?.[0]);
    if (Number.isFinite(pid) && pid > 0) {
      expect(await eventually(() => !alive(pid), 2_000)).toBe(true);
    }
  }, 10_000);

  it("never starts a command whose signal is already aborted", async () => {
    const shell = createLocalShell(os.tmpdir());
    const ac = new AbortController();
    ac.abort();
    const r = await shell.run("node -e \"console.log('ran')\"", { signal: ac.signal });
    expect(r.aborted).toBe(true);
    expect(r.stdout ?? "").not.toContain("ran");
  });

  it("runs a command to completion when nothing stops it", async () => {
    const shell = createLocalShell(os.tmpdir());
    const r = await shell.run("node -e \"console.log('hello')\"", { signal: new AbortController().signal });
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("hello");
  });
});

describe("localShell background jobs", () => {
  it("starts a job, reports it running, and kills it on command_stop", async () => {
    const shell = createLocalShell(os.tmpdir());
    const started = await shell.start(LONG_CHILD);
    expect(started.ok).toBe(true);
    const id = started.id!;
    expect((await shell.poll(id, { waitMs: 300 })).status).toBe("running");
    const t0 = Date.now();
    const stopped = await shell.kill(id);
    expect(Date.now() - t0).toBeLessThan(3_500);
    expect(stopped.status).toBe("killed");
    expect(stopped.ok).toBe(false);
  }, 10_000);

  it("waits for a short job and hands back its exit code and output", async () => {
    const shell = createLocalShell(os.tmpdir());
    const started = await shell.start("node -e \"console.log('built');process.exit(3)\"");
    const done = await shell.poll(started.id!, { waitMs: 5_000 });
    expect(done.status).toBe("exited");
    expect(done.exitCode).toBe(3);
    expect(done.output).toContain("built");
  }, 10_000);

  it("kills the job when the run that started it stops", async () => {
    const shell = createLocalShell(os.tmpdir());
    const run = new AbortController();
    const started = await shell.start(LONG_CHILD, { signal: run.signal });
    run.abort();
    const after = await shell.poll(started.id!, { waitMs: 3_000 });
    expect(after.status).toBe("killed");
  }, 10_000);

  it("answers an unknown job id without throwing", async () => {
    const shell = createLocalShell(os.tmpdir());
    const r = await shell.poll("job-does-not-exist");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unknown");
  });
});
