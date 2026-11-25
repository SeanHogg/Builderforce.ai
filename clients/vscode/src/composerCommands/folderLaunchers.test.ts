import { describe, expect, it, vi } from "vitest";
import { FolderLaunchers, type RunningLauncher } from "./folderLaunchers";

const identity = async (file: string) => file;

function launcherOf(url: string): RunningLauncher & { close: ReturnType<typeof vi.fn> } {
  return { url, close: vi.fn(async () => undefined) };
}

describe("FolderLaunchers", () => {
  it("two concurrent starts for the same folder and environment start ONE launcher and both get it", async () => {
    const launchers = new FolderLaunchers(identity);
    const make = vi.fn(async () => launcherOf("one"));
    const [a, b] = await Promise.all([launchers.start("/x", undefined, make), launchers.start("/x", undefined, make)]);
    expect(make).toHaveBeenCalledOnce();
    expect(a).toBe(b);
  });

  it("a concurrent default and staging start: the latest wins, the other is closed, and the one held matches the latest request", async () => {
    const launchers = new FolderLaunchers(identity);
    const first = launcherOf("default");
    const second = launcherOf("staging");
    const [a, b] = await Promise.all([
      launchers.start("/x", undefined, async () => first),
      launchers.start("/x", "staging", async () => second),
    ]);
    expect(a).toBe(first);
    expect(b).toBe(second);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect((await launchers.running("/x"))?.environment).toBe("staging");
  });

  it("overlapping starts for different environments over a held launcher: each waits for the previous close, and the newest request holds the live launcher", async () => {
    const launchers = new FolderLaunchers(identity);
    const log: string[] = [];
    const named = (name: string) => {
      const launcher = launcherOf(name);
      launcher.close.mockImplementation(async () => { log.push(`close ${name}`); });
      return launcher;
    };
    const held = named("held");
    await launchers.start("/x", "c", async () => held);
    const a = named("a");
    const b = named("b");
    const [, second] = await Promise.all([
      launchers.start("/x", "a", async () => { log.push("start a"); return a; }),
      launchers.start("/x", "b", async () => { log.push("start b"); return b; }),
    ]);
    expect(second).toBe(b);
    expect(log).toEqual(["close held", "start a", "close a", "start b"]);
    expect(b.close).not.toHaveBeenCalled();
    expect((await launchers.running("/x"))?.environment).toBe("b");
  });

  it("reports a close that fails by rejecting the replacing launcher, and forgets it", async () => {
    const launchers = new FolderLaunchers(identity);
    const held = launcherOf("held");
    held.close.mockRejectedValueOnce(new Error("port busy"));
    await launchers.start("/x", "c", async () => held);
    await expect(launchers.start("/x", "d", async () => launcherOf("d"))).rejects.toThrow("port busy");
    expect(await launchers.running("/x")).toBeUndefined();
  });

  it("stops a held launcher by its stored key, even when its path no longer resolves the same", async () => {
    let real = "/real/page.html";
    const launchers = new FolderLaunchers(async () => real);
    const launcher = launcherOf("page");
    await launchers.start("/typed/page.html", undefined, async () => launcher, ["/typed"]);
    const held = (await launchers.held(["/typed"]))!;
    real = "/elsewhere/now"; // the link changed, or the file is gone
    expect(await launchers.stop(held)).toBe(true);
    expect(launcher.close).toHaveBeenCalledOnce();
    real = "/real/page.html";
    expect(await launchers.running("/typed/page.html")).toBeUndefined();
  });
});
