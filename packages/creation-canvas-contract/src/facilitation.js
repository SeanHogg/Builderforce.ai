/**
 * FACILITATION — the vocabulary a workshop is RUN in, not the one it is authored in.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────
 * The canvas could hold a `timer` and a `comment` thread and nothing else a person
 * standing in front of a room actually uses. A grep for `poll` or `vote` across
 * `creation-canvas/` returned HTTP polling and nothing about a ballot. So a board could
 * be BUILT collaboratively and never FACILITATED: no way to ask twelve people a
 * question, no way for them to answer from a phone without an account, and no way for
 * the answer to appear on the board everybody is looking at.
 *
 * ── WHY ONE `poll` KIND AND NOT EIGHT ────────────────────────────────────────────
 * The instruments a facilitator reaches for — a multiple choice, a vote, a word cloud,
 * a ranking, a 1-to-5 scale, an open question, a quiz, a 2×2 — differ in exactly two
 * things: what the participant is asked to DO, and how the answers are COUNTED. They do
 * not differ in what the object is (a question put to a room), where the answers live
 * (`responses`), who may answer (the audience), or how it is published (a slug).
 *
 * So the instrument is a VALUE, `PollFormat`, and there is one kind. That is the same
 * open/closed answer `funnelDomain` gives the marketing and hiring funnels, and the one
 * the object registry gives media types: a ninth instrument is a case in
 * {@link tallyPollVotes} plus a control, never a table, a kind or a render branch.
 *
 * ── WHY THE TALLY IS HERE AND NOT ON EITHER SIDE ─────────────────────────────────
 * Three surfaces count the same votes: the facilitator's board, the participant's phone
 * (a poll that shows live results shows them to the room, which includes the people in
 * it), and the server that aggregates them. Three implementations of "what share chose
 * B" is three answers to it — the same reason `sequenceProgress` lives in this package
 * rather than in the runner and the card. The counting is pure and takes plain values,
 * so the server can call it over rows and the browser over a projection.
 */
/**
 * The instruments. Closed deliberately, and each one is a counting rule:
 *
 * `choice`      one option of several. The ballot.
 * `multiChoice` any number of options. "Which of these apply?"
 * `scale`       an integer 1..`scaleMax`. Confidence, agreement, energy.
 * `ranking`     the options put in order. Counted by Borda points, never by first
 *               preferences alone — a ranking counted by its head is a `choice` with
 *               extra steps, and the tail is the reason anybody ranked anything.
 * `wordCloud`   a short free answer, counted by term. The one instrument whose result
 *               is a SHAPE rather than a number.
 * `openText`    a free answer, NOT counted. The Q&A: every answer is kept and shown.
 * `quiz`        a `choice` with a right answer, so the tally can say who got it.
 * `grid`        a point on two axes — the 2×2. Counted as a cloud plus quadrant shares.
 */
export const POLL_FORMATS = [
    'choice', 'multiChoice', 'scale', 'ranking', 'wordCloud', 'openText', 'quiz', 'grid',
];
export function isPollFormat(value) {
    return typeof value === 'string' && POLL_FORMATS.includes(value);
}
/** Formats whose answer is chosen from a declared option list. A poll in one of these
 *  with no options is unanswerable, which is a malformed poll rather than an empty one —
 *  the same rule `readQuestions` applies to a `select` with no options. */
export const OPTION_POLL_FORMATS = ['choice', 'multiChoice', 'ranking', 'quiz'];
export function pollNeedsOptions(format) {
    return OPTION_POLL_FORMATS.includes(format);
}
/** The lowest and highest a `scale` poll may run to. A scale of 1 has no spread and a
 *  scale of 11 is a slider nobody reads the same way twice. */
export const POLL_SCALE_MIN = 2;
export const POLL_SCALE_MAX = 10;
export const POLL_SCALE_DEFAULT = 5;
/** How many options one poll may carry. A ballot longer than this is a form. */
export const POLL_MAX_OPTIONS = 20;
/** The single `responses.question_key` every vote is stored under.
 *
 *  A poll is ONE question by construction — that is what makes it a poll rather than a
 *  form — so the key is a constant rather than an authored id. It is exported because
 *  the server writes it and the tally reads it, and two spellings of one key is a poll
 *  that counts nothing. */
export const POLL_QUESTION_KEY = 'poll';
/** The empty tally for one format. A poll nobody has answered draws this rather than
 *  nothing, so the facilitator sees the instrument waiting rather than a blank card. */
export function emptyPollTally(format) {
    return { format, responseCount: 0, entries: [], mean: null, points: [], texts: [], truncated: false };
}
/** Words a word cloud never counts. Deliberately tiny and English-only, and NOT a
 *  language-detection problem: the cloud is drawn from what a room typed, and dropping
 *  a word somebody meant is worse than showing "the" once. These are the closed-class
 *  words that would otherwise be the largest term on every cloud ever drawn. */
const CLOUD_STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in', 'is', 'it',
    'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'we', 'with', 'you',
]);
/** How many distinct terms a cloud draws. Beyond this the smallest terms are unreadable
 *  at any board zoom, so they are dropped rather than rendered as dust. */
const CLOUD_TERM_LIMIT = 40;
/** The quadrants of a 2×2, keyed low-to-high on each axis. */
const GRID_QUADRANTS = [
    { key: 'lowLow', x: 0, y: 0 },
    { key: 'highLow', x: 1, y: 0 },
    { key: 'lowHigh', x: 0, y: 1 },
    { key: 'highHigh', x: 1, y: 1 },
];
/** The quadrant keys, so a consumer can label them without re-deriving the grid. */
export const POLL_GRID_QUADRANTS = GRID_QUADRANTS.map((q) => q.key);
function shareOf(value, total) {
    return total > 0 ? value / total : 0;
}
/** Terms out of one free-text answer: lowercased words, punctuation stripped. */
function cloudTerms(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .split(/\s+/)
        .map((term) => term.replace(/^['-]+|['-]+$/g, ''))
        .filter((term) => term.length > 1 && !CLOUD_STOP_WORDS.has(term));
}
/** A stored `ranking` / `multiChoice` value as a list of option ids. */
function idList(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && !!item).slice(0, POLL_MAX_OPTIONS)
        : [];
}
/** A stored `grid` value as a point, or null when the row holds something else. */
function gridPoint(value) {
    if (!value || typeof value !== 'object')
        return null;
    const row = value;
    const x = Number(row.x);
    const y = Number(row.y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return null;
    // Clamped rather than rejected: a point a pixel outside the frame is a real answer
    // somebody dragged to the edge, and dropping it loses a vote to a rounding error.
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}
/**
 * Count the votes.
 *
 * Pure, total, and defensive about what it is handed: every value comes out of a JSONB
 * column or a browser, and a tally that throws takes the facilitator's screen down in
 * front of the room it is being projected to.
 *
 * `revealCorrect` is passed rather than inferred from the status: revealing the answer
 * to a quiz is the facilitator's act, and the board reveals it at a moment the phones
 * must not — which is a decision the caller owns and this function must not guess.
 */
export function tallyPollVotes(poll, votes, options = {}) {
    const base = emptyPollTally(poll.format);
    const truncated = options.truncated === true;
    const responseCount = votes.length;
    const withCorrect = (option) => options.revealCorrect && option.correct ? { correct: true } : {};
    switch (poll.format) {
        case 'choice':
        case 'quiz': {
            const counts = new Map();
            for (const vote of votes) {
                if (vote.text)
                    counts.set(vote.text, (counts.get(vote.text) ?? 0) + 1);
            }
            // Declaration order, NOT count order: a ballot that reorders itself as votes
            // arrive is one a room cannot read while it is moving.
            const entries = poll.options.map((option) => {
                const value = counts.get(option.id) ?? 0;
                return { key: option.id, label: option.label, value, share: shareOf(value, responseCount), ...withCorrect(option) };
            });
            return { ...base, responseCount, entries, truncated };
        }
        case 'multiChoice': {
            const counts = new Map();
            for (const vote of votes) {
                // One participant counts ONCE per option however many times they sent it.
                for (const id of new Set(idList(vote.json)))
                    counts.set(id, (counts.get(id) ?? 0) + 1);
            }
            // The denominator is PARTICIPANTS, not selections: "8 of 12 people chose B" is
            // the sentence a facilitator says out loud, and dividing by total selections
            // would answer a question nobody asked.
            const entries = poll.options.map((option) => {
                const value = counts.get(option.id) ?? 0;
                return { key: option.id, label: option.label, value, share: shareOf(value, responseCount) };
            });
            return { ...base, responseCount, entries, truncated };
        }
        case 'scale': {
            const max = Math.min(POLL_SCALE_MAX, Math.max(POLL_SCALE_MIN, poll.scaleMax ?? POLL_SCALE_DEFAULT));
            const counts = new Array(max).fill(0);
            let sum = 0;
            let counted = 0;
            for (const vote of votes) {
                const answer = Math.round(Number(vote.number));
                if (!Number.isFinite(answer) || answer < 1 || answer > max)
                    continue;
                // `counts` was sized to `max` and the guard above bounds the index, but
                // `noUncheckedIndexedAccess` cannot see that — and a non-null assertion here
                // would be an assertion about arithmetic three lines away.
                counts[answer - 1] = (counts[answer - 1] ?? 0) + 1;
                sum += answer;
                counted += 1;
            }
            const entries = counts.map((value, index) => ({
                key: String(index + 1), label: String(index + 1), value, share: shareOf(value, counted),
            }));
            return { ...base, responseCount, entries, mean: counted ? sum / counted : null, truncated };
        }
        case 'ranking': {
            // BORDA. An option ranked first on a ballot of N scores N-1, last scores 0, and
            // an option a participant left off their ranking scores nothing rather than being
            // treated as last — a ballot that punishes an omission is one people learn to
            // fill in randomly.
            const points = new Map();
            for (const vote of votes) {
                const order = idList(vote.json);
                order.forEach((id, index) => {
                    points.set(id, (points.get(id) ?? 0) + Math.max(0, order.length - 1 - index));
                });
            }
            const total = [...points.values()].reduce((sum, value) => sum + value, 0);
            const entries = poll.options
                .map((option) => {
                const value = points.get(option.id) ?? 0;
                return { key: option.id, label: option.label, value, share: shareOf(value, total) };
            })
                // Ranked BY the ranking: unlike a ballot, the order IS the result, so sorting it
                // is reporting rather than rearranging.
                .sort((left, right) => right.value - left.value);
            return { ...base, responseCount, entries, truncated };
        }
        case 'wordCloud': {
            const counts = new Map();
            for (const vote of votes) {
                for (const term of cloudTerms(vote.text ?? ''))
                    counts.set(term, (counts.get(term) ?? 0) + 1);
            }
            const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
            const entries = [...counts.entries()]
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, CLOUD_TERM_LIMIT)
                .map(([term, value]) => ({ key: term, label: term, value, share: shareOf(value, total) }));
            return { ...base, responseCount, entries, truncated };
        }
        case 'openText': {
            const texts = votes.map((vote) => (vote.text ?? '').trim()).filter(Boolean);
            return { ...base, responseCount, texts, truncated };
        }
        case 'grid': {
            const points = votes.map((vote) => gridPoint(vote.json)).filter((point) => !!point);
            const counts = new Map(GRID_QUADRANTS.map((quadrant) => [quadrant.key, 0]));
            for (const point of points) {
                const key = GRID_QUADRANTS.find((quadrant) => (point.x >= 0.5 ? 1 : 0) === quadrant.x && (point.y >= 0.5 ? 1 : 0) === quadrant.y)?.key;
                if (key)
                    counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            const entries = GRID_QUADRANTS.map((quadrant) => ({
                key: quadrant.key,
                label: quadrant.key,
                value: counts.get(quadrant.key) ?? 0,
                share: shareOf(counts.get(quadrant.key) ?? 0, points.length),
            }));
            return { ...base, responseCount, entries, points, truncated };
        }
    }
}
/**
 * Whether an answer a participant submitted is EMPTY for its format.
 *
 * One reading of "they did not answer", shared by the phone (which disables the button)
 * and the server (which refuses the vote). Two readings is a poll that accepts a blank
 * ballot from one surface and not the other.
 */
export function pollAnswerIsEmpty(format, value) {
    switch (format) {
        case 'multiChoice':
        case 'ranking':
            return !Array.isArray(value) || value.length === 0;
        case 'grid':
            return gridPoint(value) === null;
        case 'scale':
            return !Number.isFinite(Number(value));
        default:
            return typeof value !== 'string' || !value.trim();
    }
}
//# sourceMappingURL=facilitation.js.map