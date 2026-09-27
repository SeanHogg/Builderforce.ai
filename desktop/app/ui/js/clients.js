// How a caller that named itself to the service (`X-Builderforce-Client`) is shown, and
// when each was last heard from — shared by Activity and Connect.
import { t } from "./i18n.js";

const KNOWN = new Set(["vscode", "mcp", "cli", "http"]);

export const clientLabel = (client) => (KNOWN.has(client) ? t(`client.${client}`) : client);

/** Epoch ms of the newest request from `client`, or null. Entries are newest first. */
export function lastSeen(entries, client) {
  return entries.find((e) => e.client === client)?.at ?? null;
}
