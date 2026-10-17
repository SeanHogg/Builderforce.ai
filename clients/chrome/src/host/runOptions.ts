/**
 * What the composer's `/` Work panel decides about ONE run, read from the chat's device
 * record at the moment the run starts — so the record, not a React closure, is what a
 * turn obeys (the same record survives a panel reload or an offline day).
 *
 * Every translation is the shared one, never re-derived here: Effort → `max_tokens` via
 * `effortProfile`, Thinking → the vendor-neutral `reasoning` intent via
 * `reasoningForRun`, Effort's prompt nudge via `buildComposerDirectives` (the web and
 * the editor fold the same three), and project memory via `projectMemoryHooks`.
 */
import {
  buildComposerDirectives,
  effortProfile,
  isChatMode,
  projectMemoryHooks,
  reasoningForRun,
  type ChatMode,
  type EvermindRunHooks,
  type ReasoningIntent,
} from '@seanhogg/builderforce-brain-embedded';
import type { ApiClient } from '../api/apiClient';
import { portRequest } from '../api/requestPorts';
import type { LocalChat } from '../store/records';

/** Rovr is a personal assistant: a chat answers unless the person switches it to Work. */
export const ROVR_DEFAULT_CHAT_MODE: ChatMode = 'chat';

export interface RovrRunOptions {
  chatMode: ChatMode;
  maxTokens: number;
  reasoning?: ReasoningIntent;
  /** Extra system-prompt directives (Effort's nudge); '' for the neutral default. */
  directives: string;
  evermind?: EvermindRunHooks;
}

export interface RunOptionsDeps {
  getChat(chatId: number): Promise<LocalChat | undefined>;
  api: ApiClient;
  signedIn(): boolean;
  /** The project memory stands behind (Settings → project), or null. */
  projectId(): Promise<number | null>;
}

/** Whether project memory can stand behind a chat right now — signed in, with a project. */
export const memoryAvailable = (signedIn: boolean, projectId: number | null): boolean => signedIn && projectId !== null;

export function createRunOptions(deps: RunOptionsDeps): (chatId: number) => Promise<RovrRunOptions> {
  const request = portRequest(deps.api);
  return async (chatId) => {
    const [chat, projectId] = await Promise.all([deps.getChat(chatId), deps.projectId()]);
    const mode = chat?.mode;
    const effort = chat?.effort ?? 'balanced';
    const memoryOn = chat?.memoryEnabled ?? true;
    const evermind =
      memoryOn && projectId !== null && memoryAvailable(deps.signedIn(), projectId)
        ? projectMemoryHooks(projectId, request, chat?.serverId ?? null, 'rovr')
        : undefined;
    const reasoning = reasoningForRun({ effort, thinking: chat?.thinking ?? false });
    return {
      chatMode: isChatMode(mode) ? mode : ROVR_DEFAULT_CHAT_MODE,
      maxTokens: effortProfile(effort).maxTokens,
      ...(reasoning ? { reasoning } : {}),
      directives: buildComposerDirectives({ effort }),
      ...(evermind ? { evermind } : {}),
    };
  };
}
