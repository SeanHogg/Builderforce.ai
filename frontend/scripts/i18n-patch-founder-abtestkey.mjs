// i18n patch: `experiment.abTestKey` — the founder field that binds a card to a live
// `ab_tests` split. It shipped with no catalog entry in any language, so the label read
// as the raw key path; `founderObjects.test.ts` catches exactly this and was red on it.
const t = (abTestKey) => ({ creationCanvas: { founder: { field: { abTestKey } } } });
export const PATCHES = {
  en: t('A/B test key'),
  zh: t('A/B 测试标识'),
  es: t('Clave del test A/B'),
  fr: t('Clé du test A/B'),
  de: t('A/B-Test-Schlüssel'),
};
