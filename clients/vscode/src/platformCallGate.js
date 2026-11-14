import { PlatformAccessDenied } from "@builderforce/local-first";
import { platformInferenceMode, platformPolicy, platformRequestRefusalFor } from "./platformPolicy";
/** The snapshot a webview must apply so its realm matches the host's allow/deny. */
export function platformPolicyFrame(baseUrl, webUrl) {
    return { type: "platform.policy", platformPolicy: platformPolicy().snapshot(), inferenceMode: platformInferenceMode(), baseUrl, webUrl };
}
/** A websocket URL a webview asked the host to open, or null when the message is not one. */
export function platformSocketUrl(msg) {
    const record = msg;
    for (const value of [record.wsUrl, record.url]) {
        if (typeof value !== "string")
            continue;
        try {
            const protocol = new URL(value).protocol;
            if (protocol === "ws:" || protocol === "wss:")
                return value;
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * Refuse a platform socket the host would deny. A non-platform URL (loopback, a direct
 * provider) is not this gate's concern and is left alone.
 */
export function assertPlatformSocketAllowed(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return;
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
        return;
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    const refused = platformRequestRefusalFor(parsed.toString(), { method: "GET" });
    if (refused)
        throw new PlatformAccessDenied(refused);
}
//# sourceMappingURL=platformCallGate.js.map