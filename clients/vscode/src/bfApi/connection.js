import { getApiKey, getBaseUrl } from "../gateway";
import { authed } from "./transport";
/**
 * Probe the full chain (key → token exchange → /api/projects) and return a readable
 * report of the exact status at each hop. Used by the "Diagnose Connection" command so a
 * failure shows WHERE it broke instead of a generic "backend not updated".
 */
export async function diagnose(secrets) {
    const base = getBaseUrl();
    const lines = [`Base URL: ${base}`];
    const key = await getApiKey(secrets);
    if (!key)
        return [...lines, "Not signed in (no API key stored)."].join("\n");
    lines.push(`API key: ${key.slice(0, 6)}…${key.slice(-3)} (length ${key.length})`);
    let token;
    try {
        const r = await fetch(`${base}/api/auth/tenant-api-key-token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey: key }),
        });
        const txt = await r.text();
        lines.push(`POST /api/auth/tenant-api-key-token → HTTP ${r.status}`);
        if (r.ok) {
            try {
                token = JSON.parse(txt).token;
            }
            catch {
                /* non-JSON */
            }
            lines.push(token ? "  ✓ tenant token received" : `  ✗ token missing in body: ${txt.slice(0, 140)}`);
        }
        else {
            lines.push(`  ✗ ${txt.slice(0, 200)}`);
            if (r.status === 404)
                lines.push("  → exchange endpoint not found: the API deploy is missing this build.");
        }
    }
    catch (e) {
        lines.push(`POST /api/auth/tenant-api-key-token → network error: ${e.message}`);
    }
    if (!token)
        return lines.join("\n");
    try {
        const r = await fetch(`${base}/api/projects`, { headers: { authorization: `Bearer ${token}` } });
        const txt = await r.text();
        lines.push(`GET /api/projects → HTTP ${r.status}`);
        if (r.ok) {
            let n = 0;
            try {
                n = (JSON.parse(txt).projects ?? []).length;
            }
            catch {
                /* */
            }
            lines.push(`  ✓ ${n} project(s) returned`);
        }
        else {
            lines.push(`  ✗ ${txt.slice(0, 240)}`);
            if (r.status === 428)
                lines.push("  → terms acceptance required for this user; accept the latest Terms in the web app, then retry.");
            if (r.status === 401)
                lines.push("  → token rejected by the API (JWT secret mismatch or expired). ");
        }
    }
    catch (e) {
        lines.push(`GET /api/projects → network error: ${e.message}`);
    }
    return lines.join("\n");
}
export async function connect(secrets, machineName, extensionVersion) {
    try {
        const r = await authed(secrets, "/api/vscode/connect", {
            method: "POST",
            body: JSON.stringify({ machineName, extensionVersion }),
        });
        return !!r?.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=connection.js.map