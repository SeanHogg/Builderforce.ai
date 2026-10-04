import type { CreationObjectKind } from './types';
import { isSpecObjectKind, specFieldGuidance } from '@/lib/specObjects';
import { roomAuthorshipProblem } from '@/lib/canvas/roomAuthorship';
import { creationObjectContentFields } from './creationObjectRegistry';

/*
 * Authorship: whether an object carries WORK or is an empty shell handed back to the
 * user. A different question from the registry's ("what exists, what may be written");
 * it reads the registry's content fields and decides nothing about them.
 */

/**
 * Kinds whose `title` IS their content rather than a name for it.
 *
 * Every other object on the board is a named thing with a body: a `prd` is called
 * something and then says something. A sticky is only its words, so it has one
 * field and that field starts blank — a sticky that arrives reading "New note" is
 * a card whose first interaction is deleting the text on it, which is the same
 * defect as the workflow that used to arrive saying "Ready".
 *
 * Exported because the registry's "every kind arrives named" invariant is real and
 * has exactly this exception; asserting it needs one place to read the exception
 * from, rather than each consumer spelling `kind === 'sticky'` and drifting.
 */
export const TITLE_IS_CONTENT_KINDS: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>(['sticky']);

/**
 * Kinds whose object is legitimately created EMPTY, with a reason each.
 *
 * The shell is the point for these: a Builder workspace is seeded from a starter
 * project rather than authored, a Dataset is filled by an import, a Chat holds the
 * conversation itself, and a Frame or Comment is pure canvas furniture. Everything
 * NOT listed here is an artifact whose whole value is its content.
 */
const SHELL_IS_LEGITIMATE: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>([
  // A sticky is created empty BY DESIGN — you drag one out and then type on it, which
  // is the entire interaction. It is the purest member of the "canvas furniture" set
  // this exemption was written for.
  'sticky',
  'build', 'chat', 'dataset', 'frame', 'comment', 'selection', 'timer', 'terminal',
  'browser', 'url', 'file', 'repository', 'service', 'diagnostics', 'inbox',
  // A social feed and a pinned post are READ from connected accounts, exactly as an
  // inbox is — their content arrives from the network, never from an authored patch.
  'socialFeed', 'socialPost',
  //
  // `email` is deliberately NOT here any more. It was, on the same read-from-the-network
  // reasoning — but a pinned message is built by `canvas_pin_email` from what the
  // mailbox returned and never passes through this guard at all. The only path that
  // does is `canvas_add_object`, which is the AUTHORED one: "write an email to my boss
  // asking for a raise". The exemption therefore protected nothing and excused the one
  // case it should have caught (measured 2026-08-14, ui 2026.8.15: an email tile whose
  // body read "No body").
  // A run is written BY a run. An empty one is the honest state of a suite that has
  // been dispatched and has not reported yet — the one case where a shell is the
  // truth rather than work handed back to the user.
  'testRun',
  // A `legalDocument` is FILLED BY AN UPLOAD, exactly as a `dataset` is filled by an
  // import — every field on it is `bookkeeping: true` (see `legalObjects.ts`), so a
  // freshly authored card legitimately has nothing else to show until a real file
  // lands on it.
  'legalDocument',
  // The three legal RECORD kinds, for the same reason one axis over: every field on
  // each is a projection of a `legal_entities`, `intellectual_property` or
  // `legal_matters` row that `canvas_sync_legal` writes. A card placed from the palette
  // before the sync runs is legitimately empty — and the alternative, letting the model
  // fill it to satisfy the shell rule, is the invented record `legalObjects.ts` refuses.
  'legalEntity', 'ipAsset', 'legalMatter',
]);

/**
 * Fields that ARE the work for their kind: at least one must be written, however much
 * else the patch carries.
 *
 * The rule below passes an object as soon as ANY one content field is populated, which
 * is right for a kpi (a `value` is the point) and wrong for a message, where the field a
 * model reliably fills is the SUBJECT — the envelope, not the letter. Measured
 * 2026-08-14 (ui 2026.8.15): "help me write an email to my boss asking for a raise"
 * produced an email tile rendering "No body", because `subject` alone cleared the guard.
 * The same shape is already on the record one kind over — the 2026-08-12 sweep listed
 * "an emailTemplate with no body" among its eight title-only objects.
 *
 * Registry DATA, like everything else here: a kind is covered by being listed, not by a
 * branch in the checker.
 */
const ESSENTIAL_CONTENT_FIELDS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  email: ['bodyText'],
  emailTemplate: ['bodyHtml'],
  // A campaign may carry its own copy or reference an authored template, but it cannot
  // have neither and still be something anyone could send.
  emailCampaign: ['bodyHtml', 'templateId'],
};

/** Written, as opposed to present-but-blank. Shared by both checks below so "authored"
 *  means one thing. */
export function isAuthored(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Why this authored patch would land as an EMPTY SHELL, or null when it carries work.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * `canvas_add_object` accepted `{kind, title}` and answered `ok: true`. The Canvas
 * system prompt has always said "do not create an empty shell", and three kinds
 * enforced it (website, course, drawing) with a bespoke branch each — every other kind
 * took a title and reported success.
 *
 * Measured 2026-08-12 (ui 2026.7.213): a marketing-campaign turn created nine objects
 * and EIGHT of them were title-only — a targetMarket with no segments, an emailTemplate
 * with no body, a dashboard with no KPIs, and four KPIs with no value, target or unit,
 * each stamped "Live". Brain then reported success and told the operator "you can now
 * populate these KPIs with your actual data" — the product had handed the work back and
 * called it done. (Its sibling cause was a 700-token output ceiling on guest turns that
 * truncated any call large enough to carry real content; see GUEST_CHAT_LIMITS.)
 *
 * Registry DATA rather than another branch per kind: the fields already exist in
 * MUTABLE_FIELDS, so a new object kind is covered the moment it is declared.
 */
export function emptyShellProblem(kind: CreationObjectKind, authored: Record<string, unknown>): string | null {
  if (SHELL_IS_LEGITIMATE.has(kind)) return null;
  // A room's `content` is prose about the room, not the room — only a valid preset
  // or a furniture design that survives sanitisation counts as authored work.
  if (kind === 'room') return roomAuthorshipProblem(authored);
  const essential = ESSENTIAL_CONTENT_FIELDS[kind];
  if (essential && !essential.some((field) => isAuthored(authored[field]))) {
    return `A ${kind} without ${essential.join(' or ')} is an empty shell — a subject line is the envelope, not the letter, and the user cannot send or keep what was never written. Send the full authored message in fields.${essential[0]}.`;
  }
  const contentFields = creationObjectContentFields(kind);
  if (contentFields.length === 0) return null;
  if (contentFields.some((field) => isAuthored(authored[field]))) return null;
  const problem = `A ${kind} with only a title is an empty shell — it hands the work back to the user instead of doing it. Send the authored content in fields: ${contentFields.slice(0, 12).join(', ')}.`;
  // A spec kind is taught its shape HERE, at the moment it was authored wrong, rather
  // than in the tool description for every kind on every turn: the registry's field
  // documentation is ~2 KB per kind and ~225 KB across the vocabularies, and the model
  // that sent a shell is the one that needs exactly this kind's contract now.
  return isSpecObjectKind(kind) ? `${problem}\n\n${specFieldGuidance(kind)}` : problem;
}
