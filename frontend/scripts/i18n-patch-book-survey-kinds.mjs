// Two sellable kinds shipped without catalog entries, so the storefront's kind
// chip and the canvas object label both rendered a raw dotted key:
//   - `book`   — the publication primitive (canvas object AND listing kind)
//   - `survey` — the instrument listing kind (the questions and the scoring,
//                never the responses)
// Found by src/i18n/messages.test.ts while the methodology copy was landing.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-book-survey-kinds.mjs
export const PATCHES = {
  en: {
    creationCanvas: { object: { book: 'Book' } },
    marketplaceCreations: { kind: { book: 'Book', survey: 'Survey' } },
  },
  zh: {
    creationCanvas: { object: { book: '书籍' } },
    marketplaceCreations: { kind: { book: '书籍', survey: '问卷' } },
  },
  es: {
    creationCanvas: { object: { book: 'Libro' } },
    marketplaceCreations: { kind: { book: 'Libro', survey: 'Encuesta' } },
  },
  fr: {
    creationCanvas: { object: { book: 'Livre' } },
    marketplaceCreations: { kind: { book: 'Livre', survey: 'Enquête' } },
  },
  de: {
    creationCanvas: { object: { book: 'Buch' } },
    marketplaceCreations: { kind: { book: 'Buch', survey: 'Umfrage' } },
  },
};
