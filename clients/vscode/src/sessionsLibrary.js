import { representedResourceRefs, sortCreationLibrary, formatResourceRef, } from "@builderforce/creation-canvas-contract";
function boardIsRunning(session) {
    return !!session.preview?.objects?.some((object) => object.status?.toLowerCase() === "running");
}
/**
 * Every session and chat as ONE recency-ordered list.
 *
 * A chat a board already holds a card for is left out: clicking that card's board and
 * clicking the chat row land in the same panel on the same conversation, so a second
 * row would be two doors into one room — the same rule the web library applies, from
 * the same shared implementation.
 */
export function sessionsLibraryRows(input) {
    const represented = representedResourceRefs(input.sessions);
    const running = input.runningChatIds ?? new Set();
    const canvases = input.sessions.map((session) => ({
        key: `canvas:${session.id}`,
        facet: "canvas",
        title: session.title || "",
        lastActivityAt: session.lastActivityAt ?? null,
        pinned: !!session.pinned,
        shared: (session.collaboratorCount ?? 1) > 1,
        running: boardIsRunning(session),
        source: { kind: "canvas", session },
    }));
    const conversations = input.chats
        .filter((chat) => !represented.has(formatResourceRef("chat", chat.id)))
        .map((chat) => ({
        key: `chat:${chat.id}`,
        facet: "chat",
        title: chat.title || "",
        lastActivityAt: chat.updatedAt ?? null,
        // A chat has no pin and no roster of its own in this list: multi-party chats
        // report `participants`, which is who is IN it rather than who it is shared
        // WITH, and reading one as the other would put every agent-assisted chat under
        // "Shared" beside the boards people actually invited each other to.
        pinned: false,
        shared: false,
        running: running.has(chat.id),
        source: { kind: "chat", chat },
    }));
    return sortCreationLibrary([...canvases, ...conversations]);
}
/** The rows a group shows. `all` is the list itself — a group, not a filter. */
export function sessionsLibraryGroup(rows, group, 
/** How many rows "all" shows before the list stops being a sidebar. */
recentLimit = 20) {
    if (group === "pinned")
        return [...rows].filter((row) => row.pinned);
    if (group === "shared")
        return [...rows].filter((row) => row.shared);
    if (group === "running")
        return [...rows].filter((row) => row.running);
    if (group === "archived")
        return [...rows]; // already filtered by the tree
    return rows.slice(0, recentLimit);
}
/**
 * The tree-item id for a row AS SHOWN IN A GROUP.
 *
 * Scoped by group on purpose. The four groups are FACETS of one list, so a pinned,
 * shared or running row is drawn twice — once under "Recent" and once under its
 * facet. VS Code keys tree items by `TreeItem.id` across the WHOLE tree, so two rows
 * sharing an id are one node to it: the second registration displaces the first, and
 * the displaced node's disposables run — which drops the CONVERTED command sitting
 * behind the row still on screen. Clicking it then fails with
 * "Actual command not found, wanted to execute builderforce.openSession", and it
 * fails for exactly the rows that appear in two groups, which is why only SOME rows
 * in the list were ever affected.
 *
 * Kept here, next to the grouping it has to agree with, so a new facet cannot add a
 * duplicate id without going through this function.
 */
export function sessionsLibraryRowId(group, row) {
    const source = row.source.kind === "canvas"
        ? `creation:${row.source.session.id}`
        : `chat:${row.source.chat.id}`;
    return `${group}:${source}`;
}
//# sourceMappingURL=sessionsLibrary.js.map