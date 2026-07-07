// i18n patch: task-drawer Release + Delay-reason field labels.
const t = (release, delayReason) => ({ taskMgmt: { release, delayReason } });
export const PATCHES = {
  en: t('Release', 'Delay reason'),
  zh: t('发布版本', '延误原因'),
  es: t('Versión', 'Motivo del retraso'),
  fr: t('Version', 'Cause du retard'),
  de: t('Release', 'Verzögerungsgrund'),
};
