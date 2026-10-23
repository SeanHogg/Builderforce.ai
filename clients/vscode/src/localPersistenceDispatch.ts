/**
 * The host side of `local.persistence`: run ONE named method of the host's Brain
 * persistence for the webview, fail-safe. Pure (no `vscode`), so it is tested against
 * the real adapter without an extension host.
 *
 * The name crosses a process boundary, so it is checked twice: against the shared list
 * both sides compile against (`LOCAL_PERSISTENCE_METHODS`), and against the object
 * actually holding a function by that name. A name that fails either is a typed refusal
 * plus a report naming it — never `s[i.method] is not a function`, which is what
 * 2026.10.57 showed on open when the list named `listChats` and the object behind it
 * (a write-only twin of the Brain adapter) had no such method.
 */
import { submitLocalTurnVerdict } from "@seanhogg/builderforce-brain-embedded";
import { isLocalPersistenceMethod } from "./bridgeProtocol";

/** Refusal sentence for a `local.persistence` method the host cannot run. */
export const UNKNOWN_PERSISTENCE_METHOD = "Unsupported local persistence operation";

export type LocalPersistenceAnswer = { ok: true; result: unknown } | { ok: false; error: string };

export async function callLocalPersistence(
  persistence: object,
  method: unknown,
  args: unknown,
  report: (line: string) => void = () => undefined,
): Promise<LocalPersistenceAnswer> {
  const fn = isLocalPersistenceMethod(method) ? (persistence as Record<string, unknown>)[method] : undefined;
  if (typeof fn !== "function") {
    report(`[webview bridge] local.persistence refused unknown method ${JSON.stringify(method)}`);
    return { ok: false, error: UNKNOWN_PERSISTENCE_METHOD };
  }
  try {
    const list = Array.isArray(args) ? args : [];
    const result: unknown = await (fn as (...a: unknown[]) => unknown).apply(persistence, list);
    if (method === "setMessageFeedback") submitRatingVerdict(list[2]);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * E5 on the editor: the model stream (and so the deferred local-success label) lives in
 * this extension host, not the webview that drew the thumb — so the webview's rating
 * carries `localVerdict` (set by the shared conversation hook only for the chat's latest
 * reply) and it is resolved here. A no-op for any other context.
 */
function submitRatingVerdict(context: unknown): void {
  const verdict = (context as { localVerdict?: { chatId?: unknown; passed?: unknown } | null } | null | undefined)?.localVerdict;
  if (verdict && typeof verdict.chatId === "number" && Number.isFinite(verdict.chatId) && typeof verdict.passed === "boolean") {
    submitLocalTurnVerdict(verdict.chatId, verdict.passed);
  }
}
