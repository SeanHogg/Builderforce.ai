/**
 * What the note card says beyond a selection's own facts, pure: its risk in words (`High risk` / `No risk flags`, with the
 * swatch's tone) and the answer to the question being asked (the question, bold, and `answerLine` of `answerFor`: the text
 * the header used to carry beside the answer mode). The card draws it; nothing here is a model call.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { fillTemplate } from '../../labels';
import type { ThemeTone } from '../../scene/themeColors';
import { answerFor, answerLine, type QuestionId } from '../questions';
import type { Station } from '../stations';
import type { RiskFact } from './CardActions';
import type { NoteAnswer } from './NoteCard';

/**
 * The risk row: the level's localized word (`statWords.anti`) when something is flagged (in its severity tone), else
 * "No risk flags". The word goes in as it is; `riskWord` carries any capitalisation its language needs.
 */
export function riskFactOf(flag: { word: string; tone: ThemeTone } | null, labels: KnowledgeGraphLabels): RiskFact {
    const t = labels.surface.map.card;
    return flag ? { text: fillTemplate(t.riskWord, { level: flag.word }), tone: flag.tone } : { text: t.noRisk, tone: null };
}

/** The answer row's words. `icon` is the caller's (the question's glyph). */
export function answerOf(
    question: QuestionId, surface: { stations: { stations: readonly Station[] }; lit: ReadonlySet<string> | null }, labels: KnowledgeGraphLabels,
): Omit<NoteAnswer, 'icon'> {
    return { lead: labels.surface.questions[question], text: answerLine(answerFor(question, surface), labels) };
}
