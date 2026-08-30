import { describe, it } from 'vitest';
import { isServableText } from './textCoherence';
import { scoreEnglishWordiness, detectLatinLanguage } from './wordLexicon';

const SAMPLES: [string, string][] = [
  ['Summarize the current status of the project.', 'ss author dollation section code exostolated so the PRD date and the ticketionsode authatP moffat section'],
  ['What has the team been working on recently?', 's sopactuth sar the sed then doas Requirements so the PRD so the BA requirements socken repo and theuthor the'],
  ['List the main things left to do.', 's codecPRD bAnd APReus and the coded tocket dole ticket so the Requirements repo code toolete so'],
];

describe('scratch', () => {
  it('grades the real samples', () => {
    for (const [prompt, text] of SAMPLES) {
      const v = isServableText(text, { context: prompt });
      const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
      const lang = detectLatinLanguage(words, text);
      const raw = text.split(/\s+/u);
      const cores = raw.map((r) => r.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '').toLowerCase().replace(/['’-]/gu, ''));
      const score = scoreEnglishWordiness(cores.filter(Boolean), raw.filter((_, i) => !!cores[i]), prompt);
      console.log(JSON.stringify({ text: text.slice(0, 40), verdict: v, words: words.length, lang, score }, null, 1));
    }
  });
});
