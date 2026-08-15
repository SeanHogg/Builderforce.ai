/**
 * Every user-facing sentence a Creation Canvas turn can produce that the MODEL did not
 * write.
 *
 * ── WHY THESE ARE INJECTED RATHER THAN WRITTEN INLINE ────────────────────────────
 * A canvas turn hands its result straight to the session transcript, so a runtime notice
 * — "I couldn't prepare any canvas changes from that request", "nothing was created",
 * the page-count warning — is read by the user as Brain speaking. They were hardcoded
 * English inside the turn runner, which meant a French or Chinese visitor on the public
 * landing canvas got an English system line in the middle of their own conversation, on
 * the surface most likely to be their first contact with the product.
 *
 * The runner is not a React component and must not be, so it cannot call
 * `useTranslations` itself. It takes this object instead: the surface builds it from the
 * catalogs and passes it in. The English text therefore lives in `en.json` with its four
 * translations and NOWHERE else — no module-level default to drift from them.
 *
 * `GuestAiUnavailableError` already proved the shape one case over: it is thrown as a
 * TYPE precisely so the surface can say it in the visitor's language.
 */

/** The narrow slice of a next-intl translator these notices need. */
export type CanvasNoticeTranslator = (key: string, values?: Record<string, string | number>) => string;

export interface CanvasNotices {
  /** A canvas change was proposed but the model said nothing about it. */
  addedToCanvas: string;
  /** The turn produced neither an answer nor a change. */
  noAnswer: string;
  /** The model provider accepted the request and then went silent, so the turn was
   *  abandoned rather than left spinning. Distinct from `noAnswer`: nothing is wrong
   *  with what was asked, and retrying is the right next move. */
  providerStalled: string;
  /** A tool failed, and its error is the most useful thing the turn can report. */
  toolError(detail: string): string;
  /** The model answered, but never executed the change the request asked for. Its answer
   *  is the deliverable and is kept; this is appended so the board is not misrepresented. */
  answeredWithoutCanvasChange(answer: string): string;
  /** The answer CLAIMED an artifact that does not exist, so it is replaced. */
  unverifiedCreation(hasTabularData: boolean): string;
  /** The answer quoted placeholder figures on a canvas that holds real rows. */
  fabricatedData(answer: string): string;
  /** A page count was requested and no authored document verifies it. */
  documentUnverified(requestedPages: number): string;
  /** A document was authored, and it is measurably shorter than the request. */
  documentIncomplete(authoredWords: number, estimatedPages: number, requestedPages: number): string;
}

/**
 * Bind the `creationCanvas.notice` catalog into the shape the turn runner consumes.
 *
 * Cheap and pure, so a caller may build it per render; the surface memoizes it anyway to
 * keep the turn options stable.
 */
export function canvasNoticesFrom(t: CanvasNoticeTranslator): CanvasNotices {
  return {
    addedToCanvas: t('addedToCanvas'),
    noAnswer: t('noAnswer'),
    providerStalled: t('providerStalled'),
    toolError: (detail) => t('toolError', { detail }),
    answeredWithoutCanvasChange: (answer) => `${answer}\n\n${t('answeredWithoutChange')}`,
    unverifiedCreation: (hasTabularData) => t(hasTabularData ? 'unverifiedCreationTabular' : 'unverifiedCreationPlain'),
    fabricatedData: (answer) => `${answer}\n\n${t('fabricatedData')}`,
    documentUnverified: (requestedPages) => t('documentUnverified', { requestedPages }),
    documentIncomplete: (authoredWords, estimatedPages, requestedPages) =>
      t('documentIncomplete', { authoredWords, estimatedPages, requestedPages }),
  };
}
