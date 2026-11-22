/**
 * THE one request-intent classifier (fix brief W2, chat #168571).
 *
 * A user message has two halves: the ASK — the person's own words — and pasted
 * CONTEXT: a recommendation, a diff, a transcript. The incident: "Review the
 * recommendation for the MCP below; Is this something we want to do?" followed by a
 * third-party paste full of "add"/"publish"/"let" verbs. Every classifier tested the
 * WHOLE text, so the paste's verbs read as a work order: the run routed `full`
 * (score 0.86), armed a commit ship policy, and spent 13 turns deliberating instead
 * of answering a question.
 *
 * {@link classifyRequest} splits the halves ONCE and decides intent on the ASK only:
 *
 *  - ask = the lead paragraph (up to the first blank line) when it ends in `?`/`:`
 *    or points at what follows ("below", "the following", "this"); else the whole
 *    text. The VSIX composer marks no text pastes (`BrainComposer.onPaste` handles
 *    image files only), so the paragraph boundary is the only marker there is.
 *  - question/change/route signals are read on the ask; the context adds DOMAIN
 *    hints only — never a change verb, never route weight.
 *  - an imperative change verb aimed at us in the ask ("review this and fix it",
 *    "Can you fix the session refresh?") keeps it a change, even when the ask also
 *    asks a question. A verb inside an interrogative ("how do I add a column?") is
 *    a question ABOUT a change, not a request for one.
 *
 * Consumers: `asksForChange` (this package), pipeline-route's `questionOnly`,
 * workload's action classifier and the Brain run preamble (`isChangeRequest` /
 * `expectsChange` / the ship-policy trace). It lives HERE because agent-stall is the
 * lowest package they all already resolve — zero-dependency by charter — so no new
 * package is needed (`scripts/check-source-package-graph.mjs` stays green with only
 * tsconfig `paths` for the two new sibling edges).
 *
 * PURE — no I/O, no env, no clock. The word lists are data.
 */

/** What a request asks for: an ANSWER, or an EFFECT on the world. */
export type RequestIntent = 'question' | 'change';

/** Why the classifier decided — the signals, as data, for traces and tests. */
export interface RequestSignals {
  /** The ask opens with an interrogative or a request modal, or carries a question lead. */
  questionLead: boolean;
  /** The ask ends in `?`. */
  questionMark: boolean;
  /** The ask opens by asking to LOOK (review / explain / investigate …). */
  researchLead: boolean;
  /** A change verb chained onto the look ("… and fix it") — a work order. */
  chainedChange: boolean;
  /** A change verb in the ask (any position within the head). */
  changeVerb: boolean;
  /** "complete / finish / finalize the work" — a work order (chat #5739). */
  finishOrder: boolean;
  /** "continue / resume this chat's unfinished work" — resuming IS change work. */
  resumesWork: boolean;
  /** A bare continuation directive ("fix", "go ahead") — its subject is the turn above. */
  continuation: boolean;
  /** The lead paragraph was split off as the ask; the rest is pasted context. */
  askSplit: boolean;
}

export interface RequestClassification {
  intent: RequestIntent;
  /** The user's own words — the only text question/change/route signals read. */
  ask: string;
  /** Everything after the ask: pasted context. Domain hints only, never weight. */
  context: string;
  signals: RequestSignals;
}

/**
 * Verbs that demand an EFFECT on the world rather than an explanation of it — the
 * union of the lists agent-stall and pipeline-route each kept privately. Verb-led
 * and narrow: a false positive needs the user to have used an action verb about a
 * non-action, and the question shapes below are checked first.
 */
const CHANGE_VERBS =
  'add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge|convert|port';
const CHANGE_VERB = new RegExp(`\\b(${CHANGE_VERBS})\\b`, 'i');

/** What a research request asks to be handed back — writing one is the answer, not a change. */
const REPORT_OBJECTS = 'summary|report|findings|notes|overview|write-?up|answer|explanation|list|table|recommendations?';

/**
 * A change verb AIMED AT US: not "show me …" (the reader is the object) and not
 * "write a summary" (the report is the object). This is the imperative that keeps a
 * question-shaped ask a change ("Can you fix the session refresh?").
 */
const CHANGE_VERB_AIMED = new RegExp(
  `\\b(${CHANGE_VERBS})\\b`
    + `(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  'i',
);

/**
 * "Complete / finish / finalize THE work" — a work order (chat #5739). Only as an
 * imperative with its object: the adjective ("a complete list") is not a change.
 * Opens the request, or chains onto one.
 */
const FINISH_OBJECT = '(complete|finish|finali[sz]e)\\s+(the|this|that|these|those|it|my|our|your|all|implementation|work|task|change)\\b';
const FINISH_ORDER = new RegExp(`^\\s*(please\\s+)?(now\\s+)?${FINISH_OBJECT}`, 'i');
const CHAINED_FINISH = new RegExp(`(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*${FINISH_OBJECT}`, 'i');

/** "Continue / resume / pick up the unfinished work" — an auto-continue or a person
 *  resuming earlier work is a change request, never a question to answer afresh. */
const RESUMES_WORK =
  /^\s*(please\s+)?(now\s+)?(continue|resume|carry on with|pick up)\b[^?\n]{0,80}\b(work|tasks?|tickets?|implementation|changes?|items?|threads?)\b/i;

/**
 * Interrogatives: a question ABOUT the world. An action verb inside one ("why did
 * you change X?", "how do I add a column?") is about a change, not a request for one.
 */
const INTERROGATIVE = /^\s*(what|why|how|where|when|which|who|is|are|was|were|does|do|did|should|would|will)\b/i;

/** Request modals: "Can you fix X?" is an imperative wearing a question mark. */
const REQUEST_MODAL = /^\s*(can|could)\b/i;

/**
 * Question leads that open mid-sentence — after "Review … ;" the incident's real
 * ask was "Is this something we want to do?", which no anchored shape could see.
 * Data, so a new phrasing is one entry, not a new branch.
 */
const QUESTION_LEADS: readonly RegExp[] = [
  /\bis this something (?:we|you) want\b/i,
  /\bshould we\b/i,
  /\bdo we want\b/i,
  /\bwhat do you think\b/i,
  /\bworth doing\b/i,
  /\breview\b[^?]{0,120}[;,—–-]\s*(?:is|are|should|do|does|can|would|will)\b[^?]{0,120}\?/i,
];

/**
 * Requests that open by asking to LOOK — read, explain, review, research. On their
 * own they are questions; "Review the PRD and implement WS1" is a work order that
 * happens to start by looking (chat #6: 778 analysis turns).
 */
const RESEARCH_LEAD =
  /^\s*(explain|describe|summar\w*|tell me|show me|list|compare|review|analyse|analyze|research|investigate|find|locate|trace|audit|look into|search)\b/i;

/**
 * A change verb CHAINED onto the look ("… and fix it", "Review the PRD. Implement
 * WS1.") — unless what it acts on is the report itself or the reader ("… and show
 * me the gaps").
 */
const CHAINED_CHANGE = new RegExp(
  `(\\band|\\bthen|[,.;])\\s+((also|then|please|now)\\s+)*(${CHANGE_VERBS})\\b`
    + `(?!\\s+(me|us)\\b|\\s+(up\\s+)?((a|an|the|your|me|us|my)\\s+)?(short\\s+|brief\\s+)?(${REPORT_OBJECTS})\\b)`,
  'i',
);

/** The lead paragraph points at what follows — the paste boundary the ask names. */
const POINTS_BELOW = /\b(below|the following|as follows)\b|\bthis\b/i;

/** Only the opening of an ask decides its shape (the 600-char head agent-stall read). */
const ASK_HEAD_CHARS = 600;

/**
 * Bare directives that carry no subject of their own ("fix", "go ahead", "yes").
 * Anchored and whole-string: "fix the login redirect" says what to do and is read
 * normally. A continuation RESUMES change work — its subject is the proposal in the
 * turn above — so it classifies as a change even though it names no verb object.
 */
const CONTINUATION =
  /^\s*(?:ok(?:ay)?[,\s]*)?(?:please\s+)?(?:now\s+)?(?:just\s+)?(?:go\s+ahead|carry\s+on|keep\s+going|make\s+it\s+so|do\s+it|do\s+that|do\s+so|fix\s+it|fix\s+that|apply\s+it|apply\s+that|apply|fix|go|proceed|continue|yes|yep|yeah|y|sure|confirm(?:ed)?|approved?|ship\s+it|send\s+it|run\s+it|do\s+the\s+fix|make\s+the\s+change)\s*[.!]*\s*$/i;

/** Longest a turn can be and still be a pure "you know what I mean" directive. */
const MAX_CONTINUATION_CHARS = 40;

/** Is this a bare "carry on with what you just proposed" directive? PURE. */
export function isContinuationText(text: string): boolean {
  const t = text.trim();
  return !!t && t.length <= MAX_CONTINUATION_CHARS && CONTINUATION.test(t);
}

/** Split the user's own words from pasted context. See the module doc for the rule. */
export function splitAskAndContext(text: string): { ask: string; context: string } {
  const t = text.trim();
  const blank = t.search(/\n[ \t]*\n/);
  if (blank > 0) {
    const lead = t.slice(0, blank).trim();
    if (/[?:]\s*$/.test(lead) || POINTS_BELOW.test(lead)) {
      return { ask: lead, context: t.slice(blank).trim() };
    }
  }
  return { ask: t, context: '' };
}

/** THE decision: what this request asks for, judged on the ask alone. PURE. */
export function classifyRequest(text: string | null | undefined): RequestClassification {
  const { ask, context } = splitAskAndContext(text ?? '');
  const head = ask.slice(0, ASK_HEAD_CHARS);
  const interrogative = INTERROGATIVE.test(head);
  const modal = REQUEST_MODAL.test(head);
  const questionMark = /\?\s*$/.test(ask);
  const lead = QUESTION_LEADS.some((re) => re.test(head));
  const researchLead = RESEARCH_LEAD.test(head);
  const chainedChange = CHAINED_CHANGE.test(head) || CHAINED_FINISH.test(head);
  const finishOrder = FINISH_ORDER.test(head);
  const resumesWork = RESUMES_WORK.test(head);
  const changeVerb = CHANGE_VERB.test(head);
  const aimedAtUs = CHANGE_VERB_AIMED.test(head) || chainedChange || finishOrder;
  const continuation = isContinuationText(ask);
  const signals: RequestSignals = {
    questionLead: interrogative || modal || lead,
    questionMark,
    researchLead,
    chainedChange,
    changeVerb,
    finishOrder,
    resumesWork,
    continuation,
    askSplit: context.length > 0,
  };
  const verdict = (intent: RequestIntent): RequestClassification => ({ intent, ask, context, signals });
  if (!ask) return verdict('question');
  // A bare directive resumes the change the turn above proposed.
  if (continuation) return verdict('change');
  // Resuming earlier work is change work, whatever else the sentence looks like.
  if (resumesWork) return verdict('change');
  // A work order chained onto a look wins over the question shape: the person asked
  // for the effect, and the looking is how it starts.
  if (researchLead) return verdict(chainedChange ? 'change' : 'question');
  // An interrogative is a question about the world — a verb inside it is quoted, not
  // commanded ("how do I add a column?", "why did you change the height?").
  if (interrogative) return verdict('question');
  // A mid-sentence question lead ("…; is this something we want to do?") is a
  // question unless an imperative is aimed at us in the same ask.
  if (lead) return verdict(aimedAtUs ? 'change' : 'question');
  // A request modal or a closing question mark: an imperative aimed at us keeps it a
  // change ("Can you fix the session refresh?"); otherwise it is a question.
  if (modal || questionMark) return verdict(aimedAtUs ? 'change' : 'question');
  return verdict(changeVerb || finishOrder || chainedChange ? 'change' : 'question');
}
