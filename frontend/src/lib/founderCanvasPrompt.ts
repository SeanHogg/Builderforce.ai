/**
 * The FOUNDER OBJECTS system block, and why it is its own module.
 *
 * ── WHY THIS BLOCK EXISTS AT ALL ─────────────────────────────────────────────────
 * Named separately in the canvas prompt for the same reason PICTURES and SOCIAL are.
 * The enormous authoring block in `creationCanvasAi.ts` teaches ARTIFACTS — charts,
 * decks, websites, datasets — and a founder's question is not an artifact request.
 * "Analyse my competitors in Florida, size the customers my GTM can reach, and tell me
 * how to win them" holds four distinct answers, and before the founder kinds existed all
 * four collapsed into one `document` full of prose: correct-sounding, unqueryable, and
 * dead the moment the next turn needed to reason over "which competitor is weakest in
 * Tampa".
 *
 * The sequence is spelled out because the objects are INPUTS TO EACH OTHER and the order
 * is load-bearing: a battlecard written before the competitor research is fiction, and a
 * segment sized before the company is read is sized against a business the model
 * imagined. Getting the order wrong produces output that looks complete and is grounded
 * in nothing.
 *
 * ── WHY IT IS A MODULE AND NOT AN INLINE STRING ──────────────────────────────────
 * Prompt CONTENT is not orchestration. `creationCanvasAi.ts` assembles the turn — the
 * message list, the tool loop, the guest branch — and a long body of instructional text
 * sitting inside it is the same mistake as a SQL string inside a route handler. Keeping
 * it here means the field contract can be composed from the registry (below) and unit
 * tested on its own, and the assembler stays a page of control flow.
 */

import { allFounderFieldGuidance } from './founderObjects';

/**
 * The block, built fresh so the FIELD CONTRACT section always reflects the registry.
 *
 * Composed rather than stored: the field documentation comes from
 * `FOUNDER_OBJECT_SPECS`, so a field added to a founder object is taught to the model in
 * the same edit that declares it. A hand-written copy here is exactly how a prompt comes
 * to instruct a model about a field the object does not have.
 */
export function founderCanvasSystemPrompt(): string {
  return `FOUNDER OBJECTS. A question about the user's own BUSINESS — competitors, market geography, customer segments, go-to-market, pricing, runway, fundraising, a decision to record — is answered with founder objects, never with a document full of prose. Prose cannot be queried by the next turn; an object can.

THE ORDER MATTERS, because these objects are inputs to each other:
1. WHO THEY ARE. If the request says "my business", "our company", or "my existing business details", call canvas_sync_company_profile FIRST. If it reports no company record, or this is an anonymous canvas, ask for the details or author a \`company\` object from what the user has already told you — never invent a business.
2. RESEARCH BEFORE ASSERTING. Competitors are a RESEARCH task: builtin_web_search to find them, builtin_web_fetch to read their own pages, and one \`competitor\` object per rival with real \`sources\`. Do not name competitors from memory.
3. GEOGRAPHY IS COORDINATES, NOT ADJECTIVES. For each competitor site call builtin_geo_geocode and write the returned lat/lng into \`locations\`. Then call canvas_map_competitors, which plots them on a real map and returns competitor density plus the metros with NO competitor presence. THE COVERAGE GAPS ARE THE FINDING — lead with them. A competitor with no coordinates is reported unmapped, which is not the same as absent from a region, and must never be described as one.
4. CUSTOMERS COME FROM THE GTM. Author \`customerSegment\` objects sized with a stated basis, and a \`gtmPlan\` whose \`channels\` actually reach them. A segment whose \`currentProvider\` names a competitor is what makes a switch strategy targetable, so fill it wherever the research supports it.
5. STRATEGY IS PER-RIVAL. "How do I win customers from them" is a \`battlecard\` per named competitor, each built on ONE \`wedge\` taken from that competitor's researched \`weaknesses\`. A battlecard with a soft wedge, or one not tied to a competitor object on the board, is a positioning doc and fails the request.
6. RECORD THE CHOICE. When the work settles on an approach, author a \`decision\` with the options actually considered and the rationale. This is the object the user will reread in six months.

Connect what you create with canvas_connect_objects: competitor→battlecard, segment→gtmPlan, company→everything. A disconnected pile of cards loses exactly the relationships that made the analysis worth doing.

NUMBERS THAT GO STALE. A runway, burn, pipeline, lead or headcount figure typed onto a card is wrong the next morning. Use \`liveMetric\` with a \`binding\` (for example "finance.runway_months", "revenue.pipeline", "growth.leads") and call canvas_refresh_live_metric, which reads the tenant's own domain data. Pair it with a \`trigger\` when the user wants to be told rather than to remember to look, and call canvas_evaluate_triggers after any refresh so a breach is reported in the same turn.

NEVER INVENT A FIGURE. Every founder object carries \`sources\`. A competitor's revenue, a segment's size, a rival's pricing: cite where it came from, or write what the source actually said ("not disclosed"). An invented precise number in a competitive analysis is worse than an absent one, because the user will act on it.

FIELD CONTRACT — author these fields, not a title:
${allFounderFieldGuidance()}`;
}
