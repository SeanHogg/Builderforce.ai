/**
 * The host↔panel wire for host-owned runs (see `brainRunHost.ts`): what the webview posts
 * to start a run, and what the host relays back — the snapshot deltas, tool announcements,
 * settles, and a chat's live sub-agents.
 */
import { getRunSnapshot, } from "@seanhogg/builderforce-brain-embedded";
import { listDelta, sentOf } from "./listDelta";
/**
 * The relay message for one chat, to one sink. The trace and the appended messages are
 * shipped as DELTAS (`listDelta.ts`): the store appends in place and trims from the head
 * only past its bound, so a frame carries the trim and the new items — never the whole
 * bounded list again unless the sink is new or the list was replaced.
 *
 * The streamed text is a delta too: a reply only grows within a turn, and resending all
 * of it on every frame made a long reply O(n²) bytes through the host. It continues from
 * what was sent when the text still starts with it; a new turn (the text reset) resends.
 */
export function syncMessageFor(entry, chatId) {
    const snapshot = getRunSnapshot(chatId);
    const last = entry.sent.get(chatId);
    const trace = listDelta(snapshot.trace, last);
    const appended = listDelta(snapshot.appended, last?.appended);
    const text = snapshot.streamingText;
    const textFrom = last?.text !== undefined && text.startsWith(last.text) ? last.text.length : 0;
    entry.sent.set(chatId, { ...sentOf(snapshot.trace), text, appended: sentOf(snapshot.appended) });
    const { trace: _omit, streamingText: _text, ...rest } = snapshot;
    return {
        type: "run.sync",
        chatId,
        snapshot: { ...rest, appended: appended.items },
        appendedDrop: appended.drop,
        appendedFrom: appended.from,
        traceDrop: trace.drop,
        traceFrom: trace.from,
        trace: trace.items,
        textFrom,
        text: text.slice(textFrom),
    };
}
//# sourceMappingURL=brainRunHostProtocol.js.map