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
import { railReadMark, refreshRail, type RailRefreshPorts } from "./refreshRail";
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
  async function read(ref: ChatRef): Promise<RailSnapshot> {
    const [facts, summary] = await Promise.all([deps.facts(), deps.summary()]);
    const clientId = chatClientIdOf(facts, ref);
    // When the rail was last taken from the platform: the store's read mark, which a refresh that
    // changed no row still moves, and which survives a reload.
    const refreshedAt = clientId ? await deps.store.read((tx) => tx.readMark(railReadMark(clientId))) : undefined;
    const rail = readRailFromFacts(facts, ref, refreshedAt);
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
      return { outcome, rail: await read(ref) };
    },
    link: (ref, ticket, linkType) => linkRailTicket(deps.store, deps, ref, ticket, linkType),
    unlink: (ref, ticket) => unlinkRailTicket(deps.store, deps, ref, ticket),
    watch(ref, post) {
      const repost = () => {
        void read(ref).then(post).catch(() => { /* a failed local read leaves the last posted rail standing */ });
      };
      return watchRail(deps.store, repost);
    },
  };
}
