// i18n patch: R&D reconciliation finance-hub panel title/subtitle.
const r = (title, subtitle) => ({ insights: { emp: { recon: { title, subtitle } } } });
export const PATCHES = {
  en: r('R&D reconciliation', 'Derived R&D credit base vs reported quarterly spend'),
  zh: r('研发对账', '推导的研发抵免基数与已报告的季度支出对比'),
  es: r('Reconciliación de I+D', 'Base de crédito de I+D derivada vs. gasto trimestral reportado'),
  fr: r('Rapprochement R&D', 'Base de crédit R&D dérivée vs dépenses trimestrielles déclarées'),
  de: r('F&E-Abgleich', 'Abgeleitete F&E-Kreditbasis vs. gemeldete Quartalsausgaben'),
};
