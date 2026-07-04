import * as vscode from "vscode";
import { getProjectEvermindHead, getTenantJwt } from "./bfApi";
import { getBaseUrl } from "./gateway";

/**
 * evermindLearn — the IDE producer for concurrent project learning
 * ([[evermind-learning-architecture]]). After an editor chat run, it hands the
 * run's text to the project's Evermind coordinator via the UNIFIED `/learn-text`
 * door — the SAME door the cloud finalize and on-prem agent post to. The
 * coordinator (the single writer) adapts the base on the text and merges the delta
 * IN ITS ALARM, so the editor never runs any training itself: this is a cheap POST.
 *
 * Off by default (`builderforce.evermindLearning`) so a manager opts in; throttled
 * to at most one contribution per project per {@link MIN_INTERVAL_MS}; fully
 * best-effort — any failure is swallowed and never blocks the chat.
 */
const MIN_INTERVAL_MS = 5 * 60_000;
const lastContribAt = new Map<number, number>();

function learningEnabled(): boolean {
  return vscode.workspace.getConfiguration("builderforce").get<boolean>("evermindLearning") ?? false;
}

/**
 * Contribute an editor chat run's text to the project's Evermind. Skips silently
 * when learning is off, throttled, the model isn't seeded, or the project is frozen.
 */
export async function contributeProjectEvermind(
  secrets: vscode.SecretStorage,
  projectId: number,
  text: string,
  prompt?: string,
): Promise<void> {
  try {
    if (!learningEnabled()) return;
    const trimmed = (text ?? "").trim();
    if (trimmed.length < 20 || !Number.isInteger(projectId) || projectId <= 0) return;
    const promptTrimmed = (prompt ?? "").trim();

    const now = Date.now();
    if (now - (lastContribAt.get(projectId) ?? 0) < MIN_INTERVAL_MS) return;

    // Cheap client-side gates so we don't POST for a project that can't learn (the
    // coordinator re-checks seeded/frozen authoritatively).
    const head = await getProjectEvermindHead(secrets, projectId);
    if (!head?.seeded || head.mode === "offline-frozen") return;

    const token = await getTenantJwt(secrets);
    if (!token) return;
    // Reserve the throttle slot up front so a burst of completions can't spam.
    lastContribAt.set(projectId, now);

    await fetch(`${getBaseUrl()}/api/projects/${projectId}/evermind/learn-text`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: trimmed.slice(0, 8000), ...(promptTrimmed ? { prompt: promptTrimmed.slice(0, 8000) } : {}) }),
    });
  } catch {
    /* best-effort: learning must never disrupt the chat */
  }
}
