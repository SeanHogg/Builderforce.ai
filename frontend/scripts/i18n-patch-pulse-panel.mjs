// i18n patch: Pulse survey DevEx-hub panel title/description.
const p = (title, desc) => ({ insights: { devexhub: { panel: { pulse: title, pulseDesc: desc } } } });
export const PATCHES = {
  en: p('Team pulse', 'Anonymous sentiment pulse — aggregate score, distribution & eNPS trend'),
  zh: p('团队脉搏', '匿名情绪脉搏——总体评分、分布与 eNPS 趋势'),
  es: p('Pulso del equipo', 'Pulso de sentimiento anónimo: puntuación agregada, distribución y tendencia eNPS'),
  fr: p("Pouls de l'équipe", 'Pouls de sentiment anonyme — score agrégé, distribution et tendance eNPS'),
  de: p('Team-Puls', 'Anonymer Stimmungspuls – aggregierter Wert, Verteilung & eNPS-Trend'),
};
