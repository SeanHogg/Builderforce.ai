/**
 * THE one mapping from a form CARD to a published form.
 *
 * Two surfaces publish the same card: the form surface (a person pressing Publish)
 * and the canvas action dispatch (Brain calling `canvas_invoke_object_action` with
 * `publish`). Two readings of "what does this card's `questions` field mean" is two
 * forms out of one card — and the one that drifts is the one nobody tested, because
 * it is reached through a model.
 *
 * So the reading lives here once, and it is DEFENSIVE for a reason this module cannot
 * avoid: these fields are authored by a person AND written by a model, so `questions`
 * can be an array of the right rows, an array of strings, or something else entirely,
 * and a malformed row must not take a surface down in front of a founder.
 */

import {
  FORM_AUDIENCES, isFormAudience, isFormFieldType,
  type FormAudience, type FormQuestion,
} from '@builderforce/creation-canvas-contract';
import type { PublishFormBody } from './founderOpsApi';

/** The fields a form card carries. Structural rather than importing `CreationNodeData`,
 *  so the API client layer does not depend on the canvas component tree. */
export interface FormCardData {
  title?: unknown;
  purpose?: unknown;
  audience?: unknown;
  anonymous?: unknown;
  questions?: unknown;
  closesAt?: unknown;
  recipients?: unknown;
  confirmationMessage?: unknown;
  questionSetId?: unknown;
  shareUrl?: unknown;
  joinUrl?: unknown;
}

export function formAudienceOf(data: FormCardData): FormAudience {
  return isFormAudience(data.audience) ? data.audience : 'anyoneWithLink';
}

export const FORM_AUDIENCE_VALUES: readonly FormAudience[] = FORM_AUDIENCES;

/**
 * The questions, out of whatever the card holds.
 *
 * A bare string is accepted as a short-text prompt and given a positional id, because
 * that is what a model writes when asked for "questions: would you use this?" and
 * refusing it would make the most common authoring path fail for a formatting reason.
 * A row with no label is dropped — an unlabelled question is one nobody can answer.
 */
export function readFormQuestions(raw: unknown): FormQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index): FormQuestion[] => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? [{ id: `q${index + 1}`, type: 'shortText', label, required: false }] : [];
    }
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return [];
    const type = isFormFieldType(row.type) ? row.type : 'shortText';
    const options = Array.isArray(row.options)
      ? row.options.flatMap((option) => typeof option === 'string' && option.trim() ? [option.trim()] : [])
      : undefined;
    const max = typeof row.max === 'number' && Number.isFinite(row.max) ? row.max : undefined;
    return [{
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `q${index + 1}`,
      type,
      label,
      required: row.required === true || row.required === 'true',
      ...(typeof row.help === 'string' && row.help.trim() ? { help: row.help.trim() } : {}),
      ...(options?.length ? { options } : {}),
      ...(max !== undefined ? { max } : {}),
    }];
  });
}

/** Recipients as `{email, name?}` — chips, rows, or a comma-separated string. */
export function readFormRecipients(raw: unknown): Array<{ email: string; name?: string }> {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\n,;]+/)
      : [];
  const seen = new Set<string>();
  const recipients: Array<{ email: string; name?: string }> = [];
  for (const value of values) {
    if (typeof value === 'string') {
      const email = value.trim();
      const key = email.toLowerCase();
      if (!email.includes('@') || seen.has(key)) continue;
      seen.add(key);
      recipients.push({ email });
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const email = typeof row.email === 'string' ? row.email.trim() : '';
    const key = email.toLowerCase();
    if (!email.includes('@') || seen.has(key)) continue;
    seen.add(key);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    recipients.push(name ? { email, name } : { email });
  }
  return recipients;
}

const chips = (raw: unknown): string[] => {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return values.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []);
};

/**
 * The default question set an idea's "Ask people" act authors.
 *
 * Problem, willingness-to-pay, switch trigger — the three things a founder needs
 * before building. Riskiest assumptions become extra long-text prompts so they are
 * tested as written, not paraphrased into a generic survey. Anonymous forms omit
 * the email field: collecting an address while claiming anonymity is a lie.
 */
export function questionsFromIdea(data: Readonly<Record<string, unknown>>, anonymous = false): FormQuestion[] {
  const problem = typeof data.problem === 'string' ? data.problem.trim() : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const questions: FormQuestion[] = [
    {
      id: 'problem',
      type: 'longText',
      label: problem || (title ? `Does "${title}" describe a problem you actually have?` : 'What problem does this solve for you?'),
      required: true,
    },
    { id: 'wouldPay', type: 'boolean', label: 'Would you pay for this?', required: true },
    { id: 'whatWouldMakeYouSwitch', type: 'longText', label: 'What would make you switch?', required: false },
  ];
  chips(data.riskiestAssumptions).forEach((assumption, index) => {
    questions.push({
      id: `assumption-${index + 1}`,
      type: 'longText',
      label: `Is this true for you: ${assumption}`,
      required: false,
    });
  });
  if (!anonymous) {
    questions.push({ id: 'email', type: 'email', label: 'Email (optional, if we may follow up)', required: false });
  }
  return questions;
}

/** The body `publishForm` wants, read once from the card. */
export function formPublishBody(data: FormCardData, objectId: string): PublishFormBody {
  const questions = readFormQuestions(data.questions);
  return {
    ...(typeof data.questionSetId === 'string' && data.questionSetId ? { questionSetId: data.questionSetId } : {}),
    title: String(data.title ?? '').trim(),
    description: typeof data.purpose === 'string' ? data.purpose : null,
    questions,
    anonymous: data.anonymous === true || data.anonymous === 'true',
    audience: formAudienceOf(data),
    closesAt: typeof data.closesAt === 'string' && data.closesAt ? data.closesAt : null,
    confirmationMessage: typeof data.confirmationMessage === 'string' ? data.confirmationMessage : null,
    objectId,
    recipients: readFormRecipients(data.recipients),
  };
}

/**
 * The address a respondent opens.
 *
 * Built from the ORIGIN the publisher is actually on rather than a configured base
 * URL: this is copied off the form surface, and a canned production host would be
 * wrong on a preview deploy and on localhost — which is where it gets demonstrated.
 */
export function formJoinUrl(slug: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/f/${slug}`;
}
