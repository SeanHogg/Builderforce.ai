// The live-invite badge beside the proposal count on an employer's postings list.
// Apply: node scripts/i18n-merge.mjs scripts/i18n-patch-live-invites.mjs
export const PATCHES = {
  en: { hires: { job: { invites: '{count} invited' } } },
  zh: { hires: { job: { invites: '已邀请 {count} 人' } } },
  es: { hires: { job: { invites: '{count} invitados' } } },
  fr: { hires: { job: { invites: '{count} invités' } } },
  de: { hires: { job: { invites: '{count} eingeladen' } } },
};
