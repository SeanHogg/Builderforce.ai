/**
 * Where a link to the knowledge graph lands on the WEB (PRD 38 §3.1) — the ONE owner of that
 * URL contract: on-prem's `/graph` answer writes it, the web app's chip routing
 * (`frontend/src/lib/knowledge/knowledgeChipRoute.ts`) and its canvas surface read it.
 *
 * The intent rides the query of the project's board (`/projects/:id?surface=knowledge&kgFocus=…&kgReview=1`):
 * the focus refs as ONE JSON-array parameter (`kgFocus`, at most {@link MAX_URL_FOCUS} — a
 * chip focuses up to 50, a URL stays short) and `kgReview=1` for the review launcher. Pure.
 */

/** The refs to focus, as a JSON array (one param survives every redirect unchanged). */
export const KNOWLEDGE_FOCUS_PARAM = 'kgFocus';
/** Present (`1`) ⇒ open on the review launcher. */
export const KNOWLEDGE_REVIEW_PARAM = 'kgReview';
/** Every param the project redirect forwards to the board. */
export const KNOWLEDGE_INTENT_PARAMS = [KNOWLEDGE_FOCUS_PARAM, KNOWLEDGE_REVIEW_PARAM] as const;
/** Refs a URL carries at most. */
export const MAX_URL_FOCUS = 20;

/** What a knowledge link asks the surface to do. */
export interface KnowledgeSurfaceIntent {
    focus: readonly string[];
    review?: boolean;
}

/** The query string (no leading `?`) that opens a project's board on the knowledge surface with `intent`. */
export function knowledgeSurfaceQuery(focus: readonly string[] = [], review = false): string {
    const query = new URLSearchParams({ surface: 'knowledge' });
    const refs = focus.slice(0, MAX_URL_FOCUS);
    if (refs.length > 0) query.set(KNOWLEDGE_FOCUS_PARAM, JSON.stringify(refs));
    if (review) query.set(KNOWLEDGE_REVIEW_PARAM, '1');
    return query.toString();
}

/** The intent a board URL's query carries (none ⇒ no focus, no launcher). `search` may start with `?`. */
export function knowledgeIntentFromQuery(search: string): { focus: string[]; review: boolean } {
    const query = new URLSearchParams(search);
    let focus: string[] = [];
    try {
        const parsed = JSON.parse(query.get(KNOWLEDGE_FOCUS_PARAM) ?? '[]') as unknown;
        if (Array.isArray(parsed)) focus = parsed.filter((f): f is string => typeof f === 'string').slice(0, MAX_URL_FOCUS);
    } catch {
        focus = []; // A hand-edited param is no focus, never a broken board.
    }
    return { focus, review: query.get(KNOWLEDGE_REVIEW_PARAM) === '1' };
}
