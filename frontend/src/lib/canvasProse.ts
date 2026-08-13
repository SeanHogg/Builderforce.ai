import type { CreationNodeData } from '@/components/creation-canvas/types';
import { creationObjectContentFields } from '@/components/creation-canvas/creationObjectRegistry';

/**
 * The words on an object, as a person would read them out.
 *
 * Read-aloud and "say this more simply" both need the same answer to "what is
 * the prose on this card", and it is not a field — it is `markdown` on a
 * document, `content` on a note, `summary` on a feed, and the body of a lesson
 * on a course. One extractor, so the button that speaks an object and the
 * control that re-levels it can never disagree about what the object says.
 */

/** Ordered: the first field that actually carries the body wins. `items` is last
 *  because a deck or a roadmap keeps its words in a list of parts rather than in
 *  one body — and a card whose words are only there still has words. */
const PROSE_FIELDS = ['markdown', 'content', 'summary', 'transcript', 'bodyText', 'text', 'objective', 'description', 'items'] as const;

/** Below this, a "card" is a label — speaking it is noise, not access. */
const MIN_PROSE = 40;
const MAX_PROSE = 20_000;

/** Markdown as speech: the marks are punctuation for the eye, not the ear. */
function spoken(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '. ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function fieldText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const entry = item as Record<string, unknown>;
        return [entry.title, entry.heading, entry.prompt, entry.body, entry.content, entry.text]
          .filter((part): part is string => typeof part === 'string').join('. ');
      }
      return '';
    }).filter(Boolean).join('. ');
  }
  return '';
}

/**
 * The prose on this object, or '' when it has none worth speaking.
 *
 * Returning '' rather than the title is what lets the read-aloud control decide
 * its own visibility: a KPI tile showing one number has nothing to read out, and
 * a control that appears there and says "42" is worse than no control.
 */
export function canvasProseText(data: CreationNodeData): string {
  const body = PROSE_FIELDS.map((field) => fieldText(data[field])).find((value) => spoken(value).length >= MIN_PROSE) ?? '';
  const spokenBody = spoken(body);
  if (!spokenBody) return '';
  const heading = [data.title, typeof data.subtitle === 'string' ? data.subtitle : ''].filter(Boolean).join('. ');
  return `${heading ? `${heading}. ` : ''}${spokenBody}`.slice(0, MAX_PROSE);
}

/**
 * Can this kind's body be REWRITTEN at a different reading level?
 *
 * Answered from the registry rather than a hand-kept list: a kind whose authored
 * content is prose (`markdown` or `content`) can be re-levelled, and a kind
 * whose content is rows, coordinates or credentials cannot. A new prose kind is
 * covered the day it is declared.
 */
export function canRelevelCanvasObject(data: CreationNodeData): boolean {
  const fields = creationObjectContentFields(data.kind);
  if (!fields.includes('markdown') && !fields.includes('content')) return false;
  return canvasProseText(data).length >= MIN_PROSE;
}
