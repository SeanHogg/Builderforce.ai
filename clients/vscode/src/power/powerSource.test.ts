import { describe, expect, it, vi } from "vitest";
import {
  cachedPowerSource, linuxPowerState, osPowerSource, parsePmset, parseWindowsBatteryStatus, POWER_CACHE_MS, queryPowerState, windowsPowerShell,
} from "./powerSource";

describe("the OS power source (PRD 41 B6)", () => {
  it("reads Win32_Battery: discharging is battery, AC/charging is mains, no battery is a desktop on mains", () => {
    expect(parseWindowsBatteryStatus("1\r\n")).toBe("battery");
    expect(parseWindowsBatteryStatus("2\r\n")).toBe("mains");
    expect(parseWindowsBatteryStatus("6")).toBe("mains");
    expect(parseWindowsBatteryStatus("")).toBe("mains");
    expect(parseWindowsBatteryStatus("1\n2\n")).toBe("mains");
    expect(parseWindowsBatteryStatus("10")).toBe("unknown");
    expect(parseWindowsBatteryStatus("garbage")).toBe("unknown");
  });

  it("reads pmset's source line", () => {
    expect(parsePmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged;")).toBe("mains");
    expect(parsePmset("Now drawing from 'Battery Power'\n -InternalBattery-0\t80%; discharging;")).toBe("battery");
    expect(parsePmset("")).toBe("unknown");
  });

  it("reads Linux power supplies", () => {
    expect(linuxPowerState([{ type: "Mains", online: "1" }, { type: "Battery" }])).toBe("mains");
    expect(linuxPowerState([{ type: "Mains", online: "0" }, { type: "Battery" }])).toBe("battery");
    expect(linuxPowerState([])).toBe("mains");
    expect(linuxPowerState([{ type: "Battery" }])).toBe("unknown");
  });

  it("osPowerSource: a failing command, an unreadable /sys folder and an unknown platform are all unknown", async () => {
    const failing = { run: async () => { throw new Error("ENOENT powershell.exe"); }, linuxSupplies: async () => undefined };
    expect(await osPowerSource("win32", failing).current()).toBe("unknown");
    expect(await osPowerSource("darwin", failing).current()).toBe("unknown");
    expect(await osPowerSource("linux", failing).current()).toBe("unknown");
    expect(await osPowerSource("aix", failing).current()).toBe("unknown");
  });

  it("osPowerSource runs Windows PowerShell by its absolute path, never a `powershell` from PATH", async () => {
    const run = vi.fn(async (_file: string, _args: readonly string[]) => "2\r\n");
    expect(await queryPowerState("win32", { run, linuxSupplies: async () => [] })).toBe("mains");
    expect(run.mock.calls[0]![0]).toBe(windowsPowerShell());
    expect(windowsPowerShell({ SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("asks the OS at most once per cache window, and a failed query is unknown", async () => {
    let t = 0;
    const query = vi.fn(async () => "battery" as const);
    const port = cachedPowerSource(query, () => t);
    expect(await port.current()).toBe("battery");
    t = POWER_CACHE_MS - 1;
    await port.current();
    expect(query).toHaveBeenCalledTimes(1);
    t = POWER_CACHE_MS;
    await port.current();
    expect(query).toHaveBeenCalledTimes(2);

    const failing = cachedPowerSource(async () => { throw new Error("no powershell"); }, () => 0);
    expect(await failing.current()).toBe("unknown");
  });
});
