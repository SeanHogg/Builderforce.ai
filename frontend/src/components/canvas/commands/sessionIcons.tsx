/* ── Session-bar commands ─────────────────────────────────────────────────────────
   The session bar used to spell these six with Unicode (`↶ ↷ ↗ ⚠ ••• ▾`), which is the
   same mistake the phone rail made and worse in two places: `↗` is the universal
   "opens somewhere else" arrow and was standing in for a SCORECARD, and `⚠` drew a
   standing warning triangle for a diagnostics report that is usually clean. Both said
   something untrue about the button under them, at whatever weight the OS font chose.
   Drawn here on the same grid as the rest of the set. */

/** Step back through the canvas's own history. */
export function UndoIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.1 6.4h6.3a3.6 3.6 0 0 1 0 7.2H6.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.8 3.5 2.9 6.4l2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The same arc, mirrored — so the pair reads as one control with two directions. */
export function RedoIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M12.9 6.4H6.6a3.6 3.6 0 0 0 0 7.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.2 3.5l2.9 2.9-2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The outcome scorecard: measured bars with the trend drawn over them. It names a
 *  READING of this session, which is why it is not an arrow leaving the page. */
/**
 * A path stepping between the cards on a board — the walkthrough of what was
 * generated. Deliberately not a question mark: this is not help, it is a tour of
 * the person's own work, and a `?` would file it under "I am confused".
 */
export function WalkthroughIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.4" width="4.6" height="3.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="9.8" y="9.8" width="4.6" height="3.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6.9 4.3h2.2a1.6 1.6 0 0 1 1.6 1.6v4.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.8 1.5" />
    <circle cx="8.9" cy="11.7" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

export function OutcomeMetricsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 13.6h12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M4.1 13.6v-3.4M8 13.6V7.4M11.9 13.6V9.1" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    <path d="M3.4 6.6 7.2 3.4l2.4 2 3.1-2.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.7 1.4" />
  </svg>;
}

/** Diagnostics: a trace being read, not an alarm being raised. The report is usually
 *  clean, and a permanent warning triangle for a clean report is an alarm nobody reads. */
export function DiagnosticsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M3.4 8.6h2.2l1.3-2.9 1.6 5 1.1-2.1h2.9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Start a call about this canvas: a headset, because the room is people talking about
 *  the thing on screen — not a telephone, which names a number rather than a session. */
export function StartCallIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.2 9.4V8a4.8 4.8 0 0 1 9.6 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    <rect x="1.7" y="9" width="3" height="4.4" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="11.3" y="9" width="3" height="4.4" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>;
}

/** Start a standup: a ring of people around a point — the circle the room seats,
 *  not the headset {@link StartCallIcon} draws. A standup is a shape people make. */
export function StandupIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    <circle cx="8" cy="2.6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="13" cy="10.9" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="3" cy="10.9" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

/** Record a narrated walkthrough: a record dot inside the board's own frame.
 *  Deliberately NOT the headset {@link StartCallIcon} draws — a call is people
 *  talking to each other, a talktrack is one person recording the board. */
export function RecordTalktrackIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.9" width="12.8" height="9.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="7.6" r="2.5" fill="currentColor" />
  </svg>;
}

/** Everything else this session can do. */
export function MoreActionsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.4" cy="8" r="1.25" fill="currentColor" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    <circle cx="12.6" cy="8" r="1.25" fill="currentColor" />
  </svg>;
}

/** Bring somebody in: a person with a plus. Deliberately NOT the share-node graph
 *  {@link CanvasSocialIcon} draws — that one publishes to accounts, this one invites
 *  a human onto this board, and the two must not look like the same button. */
export function ShareCanvasIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="6.2" cy="5.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.8 13.8a4.4 4.4 0 0 1 8.8 0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M12.6 5.4v4.2M14.7 7.5h-4.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Send it out: a box with something leaving the top of it. Distinct from
 *  {@link ShareCanvasIcon}, which brings a person IN to this board — this one puts the
 *  work somewhere strangers can reach, and the two are opposite directions on purpose. */
/** PROVE: a target, because choosing a proof is choosing which question you are
 *  willing to spend money answering — and every proof states the number that
 *  would stop it. */
export function ProveIdeaIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
  </svg>;
}

/** Put a mark on the board by hand. A nib with its stroke trailing behind it, so the
 *  glyph says "this leaves ink" rather than "this selects something". */
export function DrawIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10.6 2.5a1.5 1.5 0 0 1 2.12 2.12l-6.4 6.4-2.83.71.71-2.83Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M9.5 3.6l2.12 2.12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M2.6 14h10.8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>;
}

/** Show the board to the room. A screen with a play mark inside it — deliberately NOT
 *  {@link RunCanvasIcon}'s bare triangle, because running the board and showing it
 *  running sit in the same group and must not be the same shape. */
export function PresentIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.9" y="3" width="12.2" height="8.2" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M6.6 5.9v3.4l3-1.7Z" fill="currentColor" />
    <path d="M5.6 13.6h4.8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>;
}

export function PublishCanvasIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.4 9.9v2.7a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4V9.9" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    <path d="M8 10.6V2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M5.1 5.1 8 2.2l2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Take this board to the surface that runs it. A solid triangle, not an outline: it is
 *  the one control on the command bar that STARTS something, and the difference between
 *  "play" and "step forward" at 16px is whether the shape is filled. */
export function RunCanvasIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.6 3.1a.7.7 0 0 1 1.06-.6l6.9 4.28a.7.7 0 0 1 0 1.19l-6.9 4.28a.7.7 0 0 1-1.06-.6Z" fill="currentColor" />
  </svg>;
}

/** Fold the session bar down to what the canvas IS DOING. A chevron INTO the row it
 *  collapses, so the direction says where the controls go rather than merely that
 *  something happens. Its opposite is {@link ExpandBarIcon}. */
export function CollapseBarIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.8 4.2 6 8l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 3.4v9.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Bring the folded controls back. */
export function ExpandBarIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.2 4.2 10 8l-3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 3.4v9.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** The menu-opens marker on a worded button. Replaces the `▾` character, which the
 *  session bar drew at a different size and colour to everything beside it. */
export function DisclosureIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.4 6.3 3.6 3.6 3.6-3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Open the object palette. The board's create action, and now the first command on the
 *  phone's single board rail rather than a `+` character floating on its own.
 *
 *  The plus is INSIDE a card, and that is the whole point: on the rail this button sits
 *  directly above zoom-in, which is a bare plus. Two identical strokes stacked on one
 *  toolbar is a toolbar with one command drawn twice, so this one says what it adds. */
export function AddObjectIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 5.6v5.2M5.4 8.2h5.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>;
}

/** Put the palette away — the same rail slot, folded back. */
export function ClosePaletteIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.8 3.9 5.7 8l4.1 4.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
