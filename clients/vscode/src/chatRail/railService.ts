/**
 * The host's chat-rail service (G21): the one object the `local.chatRail` bridge talks to.
 *
 * Composition only, each part in its own module:
 *   - `buildRail`    - the rail from committed local facts (works with no platform)
 *   - `refreshRail`  - the gated platform read and its ingest
 *   - `railLinks`    - link / unlink as local records
 *   - `railWatch`    - which commits re-post the rail
 *
 * `read` NEVER touches the platform. `refresh` does, when allowed, then answers with the local copy.
 */

import type { LocalFirstStore } from "@builderforce/local-first";
import { chatClientIdOf, readRailFromFacts, type RailFacts } from "./buildRail";
import { linkRailTicket, unlinkRailTicket } from "./railLinks";
import type {
  ChatRailMutationOutcome, ChatRailRefreshOutcome, ChatRef, RailLinkType, RailSnapshot, RailTicketRef,
} from "./railProtocol";
import { refreshRail, type RailRefreshPorts } from "./refreshRail";
import { watchRail } from "./railWatch";
import type { SyncSummary } from "../sync/syncSummary";

export interface ChatRailDeps {
  store: LocalFirstStore;
  deviceId: string;
  /** The committed facts the rail and its statuses are derived from. */
  facts(): Promise<RailFacts>;
  /** The device's sync summary (shown in the rail header). */
  summary(): Promise<SyncSummary>;
  platform: RailRefreshPorts;
}

export interface ChatRailService {
  read(ref: ChatRef): Promise<RailSnapshot>;
  refresh(ref: ChatRef): Promise<{ outcome: ChatRailRefreshOutcome; rail: RailSnapshot }>;
  link(ref: ChatRef, ticket: RailTicketRef, linkType: RailLinkType): Promise<ChatRailMutationOutcome>;
  unlink(ref: ChatRef, ticket: RailTicketRef): Promise<ChatRailMutationOutcome>;
  /** Call `post` with a fresh snapshot after every commit that touches the chat's rail. Returns the stop. */
  watch(ref: ChatRef, post: (rail: RailSnapshot) => void): () => void;
}

export function createChatRailService(deps: ChatRailDeps): ChatRailService {
  /** When each chat's rail was last taken from the platform (a refresh that changed nothing still counts). */
  const refreshedAt = new Map<string, string>();

  async function read(ref: ChatRef): Promise<RailSnapshot> {
    const [facts, summary] = await Promise.all([deps.facts(), deps.summary()]);
    const clientId = chatClientIdOf(facts, ref);
    const rail = readRailFromFacts(facts, ref, clientId ? refreshedAt.get(clientId) : undefined);
    return {
      chatId: ref,
      found: rail.found,
      ...(rail.chatClientId ? { chatClientId: rail.chatClientId } : {}),
      tickets: rail.tickets,
      links: rail.links,
      runHistory: rail.runHistory,
      freshness: rail.freshness,
      summary,
    };
  }

  return {
    read,
    async refresh(ref) {
      const outcome = await refreshRail(deps.store, deps.platform, ref);
      if (outcome.status === "ok") {
        const clientId = chatClientIdOf(await deps.facts(), ref);
        if (clientId) refreshedAt.set(clientId, (deps.platform.now ?? (() => new Date()))().toISOString());
      }
      return { outcome, rail: await read(ref) };
    },
    link: (ref, ticket, linkType) => linkRailTicket(deps.store, deps, ref, ticket, linkType),
    unlink: (ref, ticket) => unlinkRailTicket(deps.store, deps, ref, ticket),
    watch(ref, post) {
      // The chat's client id is learned from the first snapshot (a number names a SERVER chat).
      let clientId: string | undefined = typeof ref === "string" ? ref : undefined;
      const repost = () => {
        void read(ref).then((rail) => {
          clientId = rail.chatClientId ?? clientId;
          post(rail);
        }).catch(() => { /* a failed local read leaves the last posted rail standing */ });
      };
      return watchRail(deps.store, () => clientId, repost);
    },
  };
}
