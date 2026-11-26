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
import type { AntiLevel } from './cardModel';
import type { NoteAnswer } from './NoteCard';

/**
 * The risk row: `riskWord` with the level's own word (`statWords.riskLevel`, already in the form the template needs: "High
 * risk", "Riesgo alto") when something is flagged, in its severity tone; else "No risk flags". Nothing is re-cased in code.
 */
export function riskFactOf(flag: { level: AntiLevel; tone: ThemeTone } | null | undefined, labels: KnowledgeGraphLabels): RiskFact {
    const m = labels.surface.map, t = m.card;
    return flag ? { text: fillTemplate(t.riskWord, { level: m.statWords.riskLevel[flag.level] }), tone: flag.tone } : { text: t.noRisk, tone: null };
}

/** The answer row's words. `icon` is the caller's (the question's glyph). */
export function answerOf(
    question: QuestionId, surface: { stations: { stations: readonly Station[] }; lit: ReadonlySet<string> | null }, labels: KnowledgeGraphLabels,
): Omit<NoteAnswer, 'icon'> {
    return { lead: labels.surface.questions[question], text: answerLine(answerFor(question, surface), labels) };
}
