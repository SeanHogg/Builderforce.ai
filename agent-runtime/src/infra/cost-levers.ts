/**
 * The cost-lever gate for the on-prem runtime — an on-device host with no tenant on the
 * local path. A partial rollout is bucketed by this install's stable id through the SAME
 * resolver the VS Code extension uses (`isOnDeviceCostLeverOn`), so a 10% lever reaches
 * about 10% of installs instead of none of them (a null tenant used to mean "off").
 *
 * The install id is the device identity's id when this install has paired (it never
 * changes for the install), else a random id persisted once beside it. Read lazily and
 * memoized; any filesystem failure degrades to no id — on only when fully rolled out.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isOnDeviceCostLeverOn, type CostLeverId } from "@builderforce/cost-levers";
import { resolveStateDir } from "../config/paths.js";

let memo: { id: string | null } | null = null;

function readDeviceId(identityDir: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(identityDir, "device.json"), "utf8")) as { deviceId?: unknown };
    return typeof parsed.deviceId === "string" && parsed.deviceId.trim() ? parsed.deviceId.trim() : null;
  } catch {
    return null;
  }
}

function readOrCreateLeverId(identityDir: string): string | null {
  const file = path.join(identityDir, "lever-install-id");
  // Absent on first run: an unreadable file reads as "not written yet".
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  if (existing) return existing;
  try {
    const id = crypto.randomUUID();
    fs.mkdirSync(identityDir, { recursive: true });
    fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
    return id;
  } catch {
    return null;
  }
}

/** This install's stable bucket id, or null when none can be read or written. */
export function onDeviceInstallId(env: NodeJS.ProcessEnv = process.env): string | null {
  if (memo) return memo.id;
  let id: string | null = null;
  try {
    const identityDir = path.join(resolveStateDir(env), "identity");
    id = readDeviceId(identityDir) ?? readOrCreateLeverId(identityDir);
  } catch {
    id = null;
  }
  memo = { id };
  return id;
}

/** Test seam: forget the memoized install id. */
export function resetOnDeviceInstallIdForTests(): void {
  memo = null;
}

/** THE lever gate on-prem. Env is read per call, so an override takes effect at once. */
export function onDeviceCostLeverOn(id: CostLeverId, env: NodeJS.ProcessEnv = process.env): boolean {
  return isOnDeviceCostLeverOn(env, id, onDeviceInstallId(env));
}
