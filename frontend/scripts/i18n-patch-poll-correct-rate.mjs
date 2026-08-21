// i18n patch: `poll.correctRate` — the one metric the lecture poll had that the shared
// facilitation poll did not, carried across when the two declarations were folded into
// one kind. See `derivePollCorrectRate` in sharedCanvasObjects.ts.
const t = (pollCorrectRate) => ({ creationCanvas: { shared: { field: { pollCorrectRate } } } });
export const PATCHES = {
  en: t('Correct'),
  zh: t('正确率'),
  es: t('Aciertos'),
  fr: t('Bonnes réponses'),
  de: t('Richtig'),
};
