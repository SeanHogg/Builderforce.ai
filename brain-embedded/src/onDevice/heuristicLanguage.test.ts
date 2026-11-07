import { describe, expect, it } from 'vitest';
import { heuristicLanguage } from './heuristicLanguage';

const SAMPLES: Array<[string, string]> = [
  ['en', 'The quick brown fox is jumping over the lazy dog and it was not afraid of the weather.'],
  ['de', 'Der Hund ist nicht in dem Haus und die Katze sitzt auf dem Tisch mit einer Maus.'],
  ['es', 'El perro no está en la casa y los gatos duermen en el jardín para que no se mojen.'],
  ['fr', 'Le chien est dans la maison et les chats ne dorment pas dans le jardin pour ce soir.'],
  ['zh', '今天天气很好，我们一起去公园散步吧。'],
];

describe('heuristicLanguage', () => {
  for (const [lang, text] of SAMPLES) {
    it(`detects ${lang}`, () => {
      const r = heuristicLanguage(text);
      expect(r?.lang).toBe(lang);
      expect(r!.confidence).toBeGreaterThanOrEqual(0.6);
      expect(r!.confidence).toBeLessThanOrEqual(0.95);
    });
  }

  it('is null for short text', () => {
    expect(heuristicLanguage('hola')).toBeNull();
    expect(heuristicLanguage('the dog')).toBeNull();
  });

  it('is null for ambiguous or unsupported text', () => {
    expect(heuristicLanguage('Lorem ipsum dolor sit amet consectetur adipiscing elit')).toBeNull();
    expect(heuristicLanguage('Привет, как дела у тебя сегодня вечером друг мой')).toBeNull();
    expect(heuristicLanguage('これは日本語の文章です。今日はいい天気ですね。')).toBeNull();
    expect(heuristicLanguage('12345 67890 12345 67890 12345 67890')).toBeNull();
  });
});
