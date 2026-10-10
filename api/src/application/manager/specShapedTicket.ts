/**
 * specShapedTicket — does a ticket's TITLE say its deliverable is a document?
 *
 * The third signal `expectsCodeDeliverable` consults, after the ticket KIND and its
 * action type. It exists for the residual mis-classification those two cannot see: a
 * plain `task` whose action type the free-model classifier labelled from the work the
 * ticket DESCRIBES ("Write the PRD for the billing API" → `backend_api`). Judged
 * code-bearing, it reached review with its (correct) document and no branch, was
 * returned to implementation, re-ran, produced the same document, and was returned
 * again — bounded only by stall triage's 3-attempt escalation.
 *
 * DELIBERATELY NARROW. The two failure directions are not symmetric: a spec ticket
 * bounced is a bounded loop, but a code ticket waved through as a spec completes with
 * nothing built and the work silently evaporates. So only an EXPLICIT document artifact
 * counts — a labelled title (`PRD: …`, `[Spec] …`) or an authoring verb whose object is
 * a document (`Write the design doc for …`) — and a title that also says "implement" is
 * code work that merely references a spec.
 */

/** The document artifacts whose authoring is the whole deliverable. */
const SPEC_ARTIFACT =
  'prd|product requirements(?: doc(?:ument)?)?|requirements doc(?:ument)?|spec|specification|' +
  'tech(?:nical)? spec|design[- ]doc(?:ument)?|rfc|adr|research (?:report|brief|doc(?:ument)?)|' +
  'analysis|research';

/** `PRD: …`, `[Spec] …`, `Research — …` — the title is labelled as a document. */
const LABELLED = new RegExp(
  `^\\s*(?:[\\[(]\\s*(?:${SPEC_ARTIFACT})\\s*[\\])]|(?:${SPEC_ARTIFACT})\\s*[:\\-–—|])`,
  'i',
);

/**
 * `Write the PRD for …`, `Draft a technical spec …` — authoring verb + document OBJECT.
 * The document must be the object (nothing between it and the verb is a `for`/`to`
 * clause, and it ends the noun phrase), so `Write tests for the spec parser` is code.
 */
const AUTHORED = new RegExp(
  `^\\s*(?:write|draft|author|prepare|produce|create)\\s+(?:up\\s+)?(?:an?\\s+|the\\s+)?` +
  `(?:(?!(?:for|to|of)\\b)[\\w-]+\\s+){0,3}?(?:${SPEC_ARTIFACT})` +
  `(?=\\s*$|\\s*[:,.\\-–—(]|\\s+(?:for|of|on|about|covering|describing|outlining)\\b)`,
  'i',
);

/** `Research …` as the leading verb — findings are the output, not a branch. */
const RESEARCH_VERB = /^\s*research\b(?!\s+(?:and|then)\s+implement)/i;

/** Code work that references a spec rather than producing one. */
const IMPLEMENTS = /\bimplement(?:s|ed|ing|ation)?\b/i;

/** True when the title names a document as the ticket's whole deliverable. PURE. */
export function isSpecShapedTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  if (IMPLEMENTS.test(title)) return false;
  return LABELLED.test(title) || AUTHORED.test(title) || RESEARCH_VERB.test(title);
}
