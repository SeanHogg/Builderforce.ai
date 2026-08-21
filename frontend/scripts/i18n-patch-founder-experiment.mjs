// i18n patch: the three `experiment` fields that bind a card to a live `ab_tests` split
// and say where its numbers came from. All three shipped with no catalog entry in any
// language, so each label read as its raw key path; `founderObjects.test.ts` catches
// exactly this and was red on them.
const t = (abTestKey, trafficAllocation, evidence) => ({
  creationCanvas: { founder: { field: { abTestKey, trafficAllocation, evidence } } },
});
export const PATCHES = {
  en: t('A/B test key', 'Traffic split', 'Evidence'),
  zh: t('A/B 测试标识', '流量分配', '证据'),
  es: t('Clave del test A/B', 'Reparto de tráfico', 'Evidencia'),
  fr: t('Clé du test A/B', 'Répartition du trafic', 'Preuves'),
  de: t('A/B-Test-Schlüssel', 'Traffic-Verteilung', 'Belege'),
};
