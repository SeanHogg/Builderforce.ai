import type { PlatformPolicySnapshot } from "@builderforce/local-first";
import { assertPlatformCapability, platformCapabilityFor, platformPolicy } from "./platformPolicy";

/**
 * Host-side wrapper for a platform call that is not a `fetch`. There is no second policy:
 * the capability is the one `platformCapabilityFor` already returns, and the decision is
 * `platformPolicy()`.
 */
export interface PlatformPolicyFrame {
  type: "platform.policy";
  platformPolicy: Readonly<PlatformPolicySnapshot>;
  baseUrl: string;
  webUrl: string;
}

/** The snapshot a webview must apply so its realm matches the host's allow/deny. */
export function platformPolicyFrame(baseUrl: string, webUrl: string): PlatformPolicyFrame {
  return { type: "platform.policy", platformPolicy: platformPolicy().snapshot(), baseUrl, webUrl };
}

/** A websocket URL a webview asked the host to open, or null when the message is not one. */
export function platformSocketUrl(msg: object): string | null {
  const record = msg as { url?: unknown; wsUrl?: unknown };
  for (const value of [record.wsUrl, record.url]) {
    if (typeof value !== "string") continue;
    try {
      const protocol = new URL(value).protocol;
      if (protocol === "ws:" || protocol === "wss:") return value;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Refuse a platform socket the host would deny. A non-platform URL (loopback, a direct
 * provider) is not this gate's concern and is left alone.
 */
export function assertPlatformSocketAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return;
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  const capability = platformCapabilityFor(parsed.toString(), { method: "GET" });
  if (!capability) return;
  assertPlatformCapability(capability);
}
