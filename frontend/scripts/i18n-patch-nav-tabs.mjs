// i18n patch: new nav tab labels (Facts / Snapshots / Persona / Workforce plan).
const t = (facts, snapshots, persona, plan) => ({ nav: { tab: { facts, snapshots, persona, plan } } });
export const PATCHES = {
  en: t('Facts', 'Reviews', 'Persona', 'Planning'),
  zh: t('事实库', '定期回顾', '角色视角', '人力规划'),
  es: t('Hechos', 'Revisiones', 'Persona', 'Planificación'),
  fr: t('Faits', 'Revues', 'Persona', 'Planification'),
  de: t('Fakten', 'Reviews', 'Persona', 'Planung'),
};
