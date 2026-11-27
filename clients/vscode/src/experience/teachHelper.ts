import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  HelperError,
  LineSplitter,
  RequestCorrelator,
  parseLine,
  type HelperEvent,
} from "./teachHelperProtocol";

/**
 * The Teach helper (`bf-teach-helper`, the native recorder/replayer): a port the rest of
 * the feature is written against, and the real implementation that drives the vendored
 * binary over JSON lines. The helper is a SEPARATE process on purpose: input hooks and
 * UI Automation / Accessibility are thread-affine, need OS permissions, and must not be
 * able to take the extension host down with them.
 *
 * - spawned with `child_process.spawn`, never through a shell, windows hidden;
 * - a missing binary or a Linux host reports `supported: false` (no throw);
 * - secrets travel only in `run.start`'s stdin line, never argv or env.
 */

export interface HelperProbe {
  supported: boolean;
  platform?: string;
}

export interface TeachHelperPort {
  /** Whether Teach can run here. Cheap after the first call. */
  probe(): Promise<HelperProbe>;
  recordStart(params: { program: string; args?: string[]; shotsDir: string }): Promise<void>;
  /** The recorded episode (engine `Episode` JSON), or null when nothing was recorded. */
  recordStop(): Promise<unknown | null>;
  runStart(skill: unknown, values: Record<string, string>): Promise<void>;
  runStop(): Promise<void>;
  approveAnswer(idx: number, approved: boolean): Promise<void>;
  onEvent(listener: (event: HelperEvent) => void): { dispose(): void };
  dispose(): void;
}

/** Where the vendored helper for this machine sits inside `out/` (`esbuild.mjs` copies it there). */
export function helperFileName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `bf-teach-helper.${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

/** The helper's absolute path, or undefined when this build did not ship one for this machine. */
export function resolveHelperBinary(
  extensionPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (platform === "linux") return undefined;
  const file = path.join(extensionPath, "out", helperFileName(platform, arch));
  return fs.existsSync(file) ? file : undefined;
}

export interface TeachHelperOptions {
  /** Absolute path of the binary; undefined = not shipped, so unsupported. */
  binary: string | undefined;
  platform?: NodeJS.Platform;
  /** One line of the helper's stderr, or a host-side note. */
  log(line: string): void;
  /** A caught error, reported (never swallowed). */
  report(error: unknown, operation: string): void;
  /** How long `hello` may take before the helper counts as unusable. */
  helloTimeoutMs?: number;
}

const UNSUPPORTED = new HelperError("unsupported", "Teach is not available on this system");

export function createTeachHelper(opts: TeachHelperOptions): TeachHelperPort {
  const platform = opts.platform ?? process.platform;
  const usable = !!opts.binary && platform !== "linux";
  const correlator = new RequestCorrelator();
  const listeners = new Set<(event: HelperEvent) => void>();
  let child: ChildProcessWithoutNullStreams | undefined;
  let probed: HelperProbe | undefined;
  /** A run is in flight: if the helper dies now, nothing else will ever say the run ended. */
  let running = false;

  function emit(event: HelperEvent): void {
    if (event.event === "run.finished") running = false;
    for (const l of [...listeners]) l(event);
  }

  function onExit(reason: string): void {
    if (running) emit({ event: "run.finished", status: "failed", error: reason });
    child = undefined;
    correlator.rejectAll(new HelperError("helper_gone", reason));
  }

  function start(): ChildProcessWithoutNullStreams {
    if (child) return child;
    if (!opts.binary) throw UNSUPPORTED;
    ensureExecutable(opts.binary, platform, opts.report);
    const proc = spawn(opts.binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    const lines = new LineSplitter();
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) {
        const msg = parseLine(line);
        if (msg.kind === "reply") correlator.settle(msg);
        else if (msg.kind === "event") emit(msg.event);
        else opts.log(`[teach-helper] unreadable line: ${msg.line.slice(0, 200)}`);
      }
    });
    const err = new LineSplitter();
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => err.push(chunk).forEach((l) => opts.log(`[teach-helper] ${l}`)));
    proc.stdin.on("error", (error) => opts.report(error, "teachHelper:stdin"));
    proc.on("error", (error) => {
      opts.report(error, "teachHelper:spawn");
      onExit(error.message);
    });
    proc.on("exit", (code, signal) => onExit(`the Teach helper exited (${signal ?? code})`));
    child = proc;
    return proc;
  }

  function call(method: string, params?: unknown): Promise<unknown> {
    if (!usable) return Promise.reject(UNSUPPORTED);
    return correlator.request(method, params, (line) => {
      start().stdin.write(line);
    });
  }

  async function probe(): Promise<HelperProbe> {
    if (!usable) return { supported: false };
    if (probed) return probed;
    let timer: NodeJS.Timeout | undefined;
    try {
      const hello = (await Promise.race([
        call("hello"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new HelperError("helper_gone", "the Teach helper did not answer hello")), opts.helloTimeoutMs ?? 5000);
        }),
      ])) as { supported?: boolean; platform?: string };
      probed = { supported: hello?.supported === true, ...(hello?.platform ? { platform: hello.platform } : {}) };
      return probed;
    } catch (error) {
      opts.report(error, "teachHelper:hello");
      child?.kill();
      return { supported: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    probe,
    async recordStart(params) {
      await call("record.start", params);
    },
    async recordStop() {
      const r = (await call("record.stop")) as { episode?: unknown } | undefined;
      return r?.episode ?? null;
    },
    async runStart(skill, values) {
      // Set before the call: a very fast run can finish before the reply is read.
      running = true;
      try {
        await call("run.start", { skill, values });
      } catch (error) {
        running = false;
        throw error;
      }
    },
    async runStop() {
      await call("run.stop");
    },
    async approveAnswer(idx, approved) {
      await call("approve.answer", { idx, approved });
    },
    onEvent(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    dispose() {
      listeners.clear();
      child?.kill();
      onExit("the Teach helper was closed");
    },
  };
}

/** A .vsix may unpack a native binary without its execute bit; set it (macOS). */
function ensureExecutable(file: string, platform: NodeJS.Platform, report: TeachHelperOptions["report"]): void {
  if (platform === "win32") return;
  try {
    fs.chmodSync(file, 0o755);
  } catch (error) {
    report(error, "teachHelper:chmod");
  }
}
