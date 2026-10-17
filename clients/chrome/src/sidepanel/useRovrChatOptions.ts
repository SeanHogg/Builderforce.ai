/**
 * The `/` Work panel's state for one Rovr chat — Mode, Effort + Thinking, Memory and the
 * Model — as the shared composer's `ComposerOptions`.
 *
 * Mode, Effort, Thinking and Memory live on the chat's DEVICE record (the run host reads
 * them per run, `host/runOptions.ts`), so they hold offline and across panel reloads;
 * Memory is mirrored to the platform chat once it exists. The model is the device-wide
 * pin Settings → Model writes too (`usePinnedModel`) — one pin, two places to set it —
 * offered from this panel's on-device models AND, signed in, the gateway catalogue the
 * web and the editor offer (brain-embedded `loadGatewayModelOptions`, read once per
 * panel session), gated by the same entitlement rule.
 * Before the first message there is no chat yet: the choices are held here and seeded
 * onto the chat the first message creates (`draft`).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  EMPTY_GATEWAY_MODEL_OPTIONS,
  invalidateGatewayModelOptions,
  loadGatewayModelOptions,
  type GatewayModelOptions,
} from '@seanhogg/builderforce-brain-embedded';
import {
  planIsPaid,
  productForPlan,
  useChatMemorySwitch,
  useConsumptionSnapshot,
  type ChatModelOptions,
  type ChatModelSelection,
  type ComposerOptions,
  type JsonRequest,
  type PromptOptionsModel,
} from '@seanhogg/builderforce-brain-ui';
import { memoryAvailable, ROVR_DEFAULT_CHAT_MODE } from '../host/runOptions';
import type { LocalChat } from '../store/records';
import { t } from '../i18n/t';
import { useLoaded, usePinnedModel, useServices, useSetting, useSignedIn } from './hooks';
import type { MemoryGap } from './labels/composerLabels';

export type ChatOptionsPatch = Partial<Pick<LocalChat, 'mode' | 'effort' | 'thinking' | 'memoryEnabled'>>;

export interface RovrChatOptions {
  options: ComposerOptions;
  /** Why project memory cannot stand behind the chat (the Memory row says so), or null. */
  memoryGap: MemoryGap;
  /** The choices made before the chat existed — seeded onto the chat the first send creates. */
  draft: ChatOptionsPatch;
  signedIn: boolean;
  /** The panel's authenticated JSON GET for the Status tab — null signed out. */
  request: JsonRequest | null;
  /** The project memory and the Status tab's Evermind read (Settings → tasks project). */
  projectId: number | null;
}

/** Signed out there is no catalogue: the menu offers this panel's on-device models only. */
const NO_GATEWAY_MODELS: ChatModelOptions = EMPTY_GATEWAY_MODEL_OPTIONS.options;

export function useRovrChatOptions(chat: LocalChat | undefined, onChatsChanged: () => void): RovrChatOptions {
  const services = useServices();
  const signedIn = useSignedIn();
  const projectId = useSetting((s) => s.taskProjectId(), null);
  const [pinned, choosePinned] = usePinnedModel();
  const [draft, setDraft] = useState<ChatOptionsPatch>({});
  const request = useMemo<JsonRequest | null>(() => (signedIn ? <T,>(path: string) => services.api.request<T>(path) : null), [services, signedIn]);
  const snapshot = useConsumptionSnapshot(request);
  // The gateway catalogue, once per panel session (cached by base URL in brain-embedded).
  // Signing out drops it, so the next sign-in reads that account's entitlements.
  const [catalog] = useLoaded<GatewayModelOptions | null>(
    () => {
      if (!request) {
        invalidateGatewayModelOptions();
        return Promise.resolve(null);
      }
      return loadGatewayModelOptions(request, services.baseUrl, { paidCostDetail: t('optPaidCostDetail') });
    },
    null,
    [request, services.baseUrl],
  );

  const patch = useCallback(
    (p: ChatOptionsPatch) => {
      if (!chat) {
        setDraft((d) => ({ ...d, ...p }));
        return;
      }
      void services.records.updateChat(chat.id, p).then(onChatsChanged, (e: unknown) => services.reportError(e, 'chat.options'));
    },
    [chat, services, onChatsChanged],
  );

  const serverId = chat?.serverId;
  const persistMemory = useCallback(
    async (chatId: number, on: boolean) => {
      await services.records.updateChat(chatId, { memoryEnabled: on });
      onChatsChanged();
      // Best-effort mirror; the device record is the source of truth (and the sync
      // carries an "off" across when the platform chat is created later).
      if (serverId && signedIn) {
        void services.api
          .request(`/api/brain/chats/${serverId}`, { method: 'PATCH', json: { memoryEnabled: on } })
          .catch(() => undefined);
      }
    },
    [services, onChatsChanged, serverId, signedIn],
  );
  const memory = useChatMemorySwitch({ chatId: chat?.id ?? null, serverValue: chat?.memoryEnabled, persist: persistMemory });

  const isPaid = snapshot ? planIsPaid(snapshot) : false;
  const store = services.pageEngines.store;
  const model = useMemo<PromptOptionsModel>(
    () => ({
      selection: pinned ? { mode: 'model', model: pinned } : { mode: 'auto' },
      options: catalog?.options ?? NO_GATEWAY_MODELS,
      onChange: (selection: ChatModelSelection) => choosePinned(selection.mode === 'model' ? selection.model : null),
      // The gateway's verdict once read. Until then (or signed out, or unreadable) the
      // menu is told entitlement is PENDING: it offers the on-device models, which need
      // no plan, without claiming the plan forbids choosing.
      identity: catalog?.identity ?? { product: productForPlan(isPaid), canChoose: false },
      identityPending: !catalog || catalog === EMPTY_GATEWAY_MODEL_OPTIONS,
      localStore: store,
    }),
    [pinned, choosePinned, catalog, isPaid, store],
  );

  const source = chat ?? draft;
  const memoryGap: MemoryGap = !signedIn ? 'signedOut' : projectId === null ? 'noProject' : null;
  const options: ComposerOptions = {
    mode: { value: source.mode ?? ROVR_DEFAULT_CHAT_MODE, onChange: (mode) => patch({ mode }) },
    effort: { value: source.effort ?? 'balanced', onChange: (effort) => patch({ effort }) },
    thinking: { value: source.thinking ?? false, onChange: (thinking) => patch({ thinking }) },
    memory: { enabled: memory.enabled, onChange: memory.setEnabled, available: memoryAvailable(signedIn, projectId) },
    model,
  };

  return { options, memoryGap, draft: { ...draft, memoryEnabled: memory.enabled }, signedIn, request, projectId };
}
