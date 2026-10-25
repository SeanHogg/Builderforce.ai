/**
 * PRD 35 E6 / E10: a background job belongs to the RUN that started it. Its id is scoped
 * to that run (another run's `command_status` / `command_stop` cannot reach it), it dies
 * when the run settles (`killRunJobs`) or the extension deactivates (`killAllJobs`), a
 * wait on it ends when its signal aborts while the job runs on, and a foreground command
 * that times out takes its whole tree with it.
 */

import * as os from "os";
import { describe, expect, it } from "vitest";
import { createLocalShell } from "./localShell";
import { killAllJobs, killRunJobs } from "./localShellJobs";

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

describe("background jobs are the run's own", () => {
  it("ids are scoped per run: another run cannot poll or stop the job", async () => {
    const mine = createLocalShell(os.tmpdir(), { jobOwner: 9101 });
    const theirs = createLocalShell(os.tmpdir(), { jobOwner: 9102 });
    const started = await mine.start(LONG_CHILD);
    expect(started.id).toBe("job-1");
    expect((await theirs.poll(started.id!)).status).toBe("unknown");
    expect((await theirs.kill(started.id!)).status).toBe("unknown");
    expect((await mine.poll(started.id!)).status).toBe("running");
    // The other run numbers its own jobs from 1 too.
    const other = await theirs.start(LONG_CHILD);
    expect(other.id).toBe("job-1");
    await killRunJobs(9101);
    await killRunJobs(9102);
  }, 15_000);

  it("a settled run's jobs are killed, and only that run's", async () => {
    const a = createLocalShell(os.tmpdir(), { jobOwner: 9111 });
    const b = createLocalShell(os.tmpdir(), { jobOwner: 9112 });
    const ja = await a.start(LONG_CHILD);
    const jb = await b.start(LONG_CHILD);
    await killRunJobs(9111);
    expect((await a.poll(ja.id!)).status).toBe("killed");
    expect((await b.poll(jb.id!)).status).toBe("running");
    await killAllJobs();
    expect((await b.poll(jb.id!)).status).toBe("killed");
  }, 15_000);

  it("aborting a wait ends the wait, not the job", async () => {
    const shell = createLocalShell(os.tmpdir(), { jobOwner: 9121 });
    const started = await shell.start(LONG_CHILD);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const t0 = Date.now();
    const st = await shell.poll(started.id!, { waitMs: 60_000, signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(st.status).toBe("running");
    expect((await shell.poll(started.id!)).status).toBe("running");
    await killRunJobs(9121);
  }, 15_000);
});

describe("a foreground command that times out", () => {
  it("is reported timed out, and its whole tree is gone", async () => {
    const shell = createLocalShell(os.tmpdir());
    const r = await shell.run(LONG_CHILD, { timeoutMs: 1_500 });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toMatch(/timed out/);
    const pid = Number(/\d+/.exec(r.stdout ?? "")?.[0]);
    if (Number.isFinite(pid) && pid > 0) {
      expect(await eventually(() => !alive(pid), 3_000)).toBe(true);
    }
  }, 15_000);
});
