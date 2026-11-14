/**
 * The knowledge view's bridge vocabulary — ONE declaration for the host
 * (`knowledgeBridge.ts`) and the webview (`webview/src/knowledgeGraph/
 * hostKnowledgeGraphSource.ts`), like `bridgeProtocol.ts`.
 *
 *   webview → host  `knowledge.call` (request/response) with one {@link KnowledgeCall};
 *   host → webview  `knowledge.event` — a review's progress / end, or a live graph, keyed
 *                   by the `stream` the webview opened it with;
 *                   `knowledge.focus` — open the Knowledge view on these refs
 *                   (`builderforce.openKnowledgeGraph`).
 *
 * A review never rides one long request (a request times out; a review can take
 * minutes, and so can planning a big folder or leaving the folder picker open): `plan`
 * answers at once and the plan arrives as a `planned` event on the stream the webview
 * opened, `run` only starts the review, and its progress and report arrive as events.
 *
 * Types only, plus the frame names: no `vscode`, no React.
 */
export const KNOWLEDGE_CALL = "knowledge.call";
export const KNOWLEDGE_EVENT = "knowledge.event";
export const KNOWLEDGE_FOCUS = "knowledge.focus";
//# sourceMappingURL=knowledgeProtocol.js.map