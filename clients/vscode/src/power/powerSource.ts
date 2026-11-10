/**
 * The OS power source behind ONE small port (PRD 41 B6): the extension host has no power API, so the background indexer
 * asks the OS whether the device runs on mains or on battery before it starts the L3 analyzers. The answer is cached for
 * {@link POWER_CACHE_MS}; a query that fails or times out is `unknown` (the indexer then runs L3 only after a long idle).
 *
 *   Windows — `Win32_Battery.BatteryStatus` through `powershell -NoProfile` (no battery ⇒ a desktop on mains);
 *   macOS   — `pmset -g batt` ("drawing from 'AC Power'" / "'Battery Power'");
 *   Linux   — `/sys/class/power_supply/<supply>/{type,online}`.
 *
 * The parsers are pure and exported for tests; only {@link osPowerSource} touches the OS.
 */

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

export type PowerState = "mains" | "battery" | "unknown";

export interface PowerSourcePort {
  current(): Promise<PowerState>;
}

/** How long one answer is trusted. */
export const POWER_CACHE_MS = 5 * 60_000;
/** Longest one OS query may take before it counts as `unknown`. */
const QUERY_TIMEOUT_MS = 5_000;

/** `Win32_Battery.BatteryStatus`: 1 discharging, 4 low, 5 critical ⇒ battery; 2 AC, 3 full, 6–9 charging ⇒ mains. */
const WIN_BATTERY = new Set([1, 4, 5]);
const WIN_MAINS = new Set([2, 3, 6, 7, 8, 9]);

/** The `BatteryStatus` values PowerShell printed (one per battery). No battery at all is a desktop: mains. */
export function parseWindowsBatteryStatus(stdout: string): PowerState {
  const codes = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").map(Number);
  if (codes.length === 0) return "mains";
  if (codes.some((c) => !Number.isInteger(c))) return "unknown";
  if (codes.some((c) => WIN_MAINS.has(c))) return "mains";
  if (codes.every((c) => WIN_BATTERY.has(c))) return "battery";
  return "unknown";
}

/** `pmset -g batt`'s first line names the source it draws from. */
export function parsePmset(stdout: string): PowerState {
  if (/'AC Power'/i.test(stdout)) return "mains";
  if (/'Battery Power'/i.test(stdout)) return "battery";
  return "unknown";
}

/** One `/sys/class/power_supply/<name>` entry. */
export interface LinuxSupply { type?: string; online?: string }

/** An online mains/USB adapter ⇒ mains; adapters all offline with a battery ⇒ battery; no battery ⇒ mains; else unknown. */
export function linuxPowerState(supplies: readonly LinuxSupply[]): PowerState {
  const adapters = supplies.filter((s) => s.type === "Mains" || s.type === "USB");
  const hasBattery = supplies.some((s) => s.type === "Battery");
  if (adapters.some((s) => s.online === "1")) return "mains";
  if (!hasBattery) return "mains";
  if (adapters.length > 0 && adapters.every((s) => s.online === "0")) return "battery";
  return "unknown";
}

/** A port that asks `query` at most once per `ttlMs`; concurrent askers share one query. A rejection is `unknown`. */
export function cachedPowerSource(query: () => Promise<PowerState>, now: () => number = Date.now, ttlMs: number = POWER_CACHE_MS): PowerSourcePort {
  let held: { at: number; value: Promise<PowerState> } | undefined;
  return {
    current() {
      const t = now();
      if (!held || t - held.at >= ttlMs) held = { at: t, value: query().catch((): PowerState => "unknown") };
      return held.value;
    },
  };
}

const run = (file: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: QUERY_TIMEOUT_MS, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });

/** Windows PowerShell by its absolute path: a `powershell` on PATH could be anything the workspace put there. */
export function windowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** The supplies, or undefined when the folder cannot be read (then the power source is unknown, never assumed mains). */
async function linuxSupplies(base = "/sys/class/power_supply"): Promise<LinuxSupply[] | undefined> {
  let names: string[];
  try { names = await readdir(base); } catch { return undefined; }
  const read = (name: string, field: string): Promise<string | undefined> =>
    readFile(`${base}/${name}/${field}`, "utf8").then((t) => t.trim(), () => undefined);
  return Promise.all(names.map(async (name) => {
    const [type, online] = await Promise.all([read(name, "type"), read(name, "online")]);
    return { ...(type !== undefined ? { type } : {}), ...(online !== undefined ? { online } : {}) };
  }));
}

/** What the OS query runs on: injected so the failure paths are tested without the OS. */
export interface PowerQueryDeps {
  run(file: string, args: readonly string[]): Promise<string>;
  linuxSupplies(): Promise<LinuxSupply[] | undefined>;
}

const osDeps: PowerQueryDeps = { run, linuxSupplies: () => linuxSupplies() };

/** One uncached query for this platform. A failed command or an unreadable folder is `unknown`; so is an unsupported platform. */
export async function queryPowerState(platform: NodeJS.Platform, deps: PowerQueryDeps = osDeps): Promise<PowerState> {
  try {
    switch (platform) {
      case "win32":
        return parseWindowsBatteryStatus(await deps.run(windowsPowerShell(), ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance -ClassName Win32_Battery).BatteryStatus"]));
      case "darwin":
        return parsePmset(await deps.run("pmset", ["-g", "batt"]));
      case "linux": {
        const supplies = await deps.linuxSupplies();
        return supplies ? linuxPowerState(supplies) : "unknown";
      }
      default:
        return "unknown";
    }
  } catch {
    return "unknown";
  }
}

/** The OS query for this platform, cached. */
export function osPowerSource(platform: NodeJS.Platform = process.platform, deps: PowerQueryDeps = osDeps): PowerSourcePort {
  return cachedPowerSource(() => queryPowerState(platform, deps));
}
