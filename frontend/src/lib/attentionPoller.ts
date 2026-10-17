/**
 * The ONE shared poll behind {@link useAttention}.
 *
 * The shell mounts several attention readers at once — the FloatingBrain badge,
 * the TopBar ManagerStatusIndicator, the Brain panel's chat-row dots — and each
 * used to own a private `setTimeout` loop against `GET /api/runtime/attention`
 * that ran on hidden tabs too. Every signed-in page therefore fired two to three
 * attention requests every 8–30 s forever, which alone keeps the database awake.
 *
 * Now one loop per scope (tenant-wide, or one project) is shared by every reader
 * through {@link createSharedPoll}: ref-counted, paused while the tab is hidden,
 * never overlapping, backing off after a failure.
 */
import { createSharedPoll } from '@/hooks/useSharedPoll';
import { runtimeApi, type AttentionResponse } from './builderforceApi';
import { getStoredTenantToken } from './auth';

export const EMPTY_ATTENTION: AttentionResponse = {
  tasks: {},
  chats: {},
  chatUnread: {},
  counts: { running: 0, awaiting: 0, unread: 0 },
  manager: { lastRunAt: null, recentlyActive: false },
};

/**
 * Reconcile cadence — a BACKSTOP behind the project room's WebSocket push. A
 * little quicker while something is live, lazy when idle, mirroring
 * useBoardLiveRuns so every live surface polls alike.
 */
const FAST_MS = 8000;
const IDLE_MS = 30000;

/** Keyed by project id; `undefined` is the tenant-wide view. */
export const attentionPoll = createSharedPoll<number | undefined, AttentionResponse>({
  initial: EMPTY_ATTENTION,
  async load(projectId, { fresh }) {
    // Workspace-scoped endpoint: a person signed in with only a web token
    // (onboarding, choosing a workspace) must not turn that valid intermediate
    // state into an unauthenticated request. Guarded here so every reader inherits it.
    if (!getStoredTenantToken()) return EMPTY_ATTENTION;
    return runtimeApi.attention(projectId, fresh);
  },
  nextDelayMs: (res) => (res.counts.running + res.counts.awaiting > 0 ? FAST_MS : IDLE_MS),
  maxDelayMs: IDLE_MS * 8,
});
