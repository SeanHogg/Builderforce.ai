// Two surfaces whose keys were rendering as dotted paths in the UI:
//   • proBonoBadge.*  — the volunteer chip on talent cards and the talent profile
//     (an advisor whose session price is 0).
//   • chatInput.ticketTag* — the #ticket autocomplete in the chat composer.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-pro-bono-and-ticket-tag.mjs
export const PATCHES = {
  en: {
    proBonoBadge: {
      label: 'Pro bono',
      accessibleName: 'Unpaid — this advisor offers volunteer sessions',
    },
    chatInput: {
      ticketTagTitle: 'Tag a ticket',
      ticketTagStatus: 'Status',
      ticketTagNoMatches: 'No matching tickets',
    },
    freelancer: {
      profile: {
        sessionPrice: 'Session price',
        sessionPriceHint: 'Price of one advisory session. Enter 0 to offer sessions pro bono; leave empty for no session price.',
      },
    },
  },
  zh: {
    proBonoBadge: {
      label: '公益',
      accessibleName: '无偿——这位顾问提供公益咨询',
    },
    chatInput: {
      ticketTagTitle: '标记工单',
      ticketTagStatus: '状态',
      ticketTagNoMatches: '没有匹配的工单',
    },
    freelancer: {
      profile: {
        sessionPrice: '咨询价格',
        sessionPriceHint: '单次咨询的价格。填 0 表示提供公益咨询；留空表示不设咨询价格。',
      },
    },
  },
  es: {
    proBonoBadge: {
      label: 'Pro bono',
      accessibleName: 'Sin coste: esta persona asesora ofrece sesiones voluntarias',
    },
    chatInput: {
      ticketTagTitle: 'Etiquetar un tique',
      ticketTagStatus: 'Estado',
      ticketTagNoMatches: 'No hay tiques coincidentes',
    },
    freelancer: {
      profile: {
        sessionPrice: 'Precio por sesión',
        sessionPriceHint: 'Precio de una sesión de asesoría. Escribe 0 para ofrecerlas pro bono; déjalo vacío si no tienes precio por sesión.',
      },
    },
  },
  fr: {
    proBonoBadge: {
      label: 'Bénévole',
      accessibleName: 'Gratuit — cette personne propose des sessions bénévoles',
    },
    chatInput: {
      ticketTagTitle: 'Associer un ticket',
      ticketTagStatus: 'Statut',
      ticketTagNoMatches: 'Aucun ticket correspondant',
    },
    freelancer: {
      profile: {
        sessionPrice: 'Prix de la session',
        sessionPriceHint: 'Prix d’une session de conseil. Saisissez 0 pour les proposer bénévolement ; laissez vide si vous n’avez pas de prix par session.',
      },
    },
  },
  de: {
    proBonoBadge: {
      label: 'Pro bono',
      accessibleName: 'Unentgeltlich – diese Person bietet ehrenamtliche Sitzungen an',
    },
    chatInput: {
      ticketTagTitle: 'Ticket verknüpfen',
      ticketTagStatus: 'Status',
      ticketTagNoMatches: 'Keine passenden Tickets',
    },
    freelancer: {
      profile: {
        sessionPrice: 'Preis pro Sitzung',
        sessionPriceHint: 'Preis einer Beratungssitzung. Geben Sie 0 ein, um sie unentgeltlich anzubieten; leer lassen, wenn es keinen Sitzungspreis gibt.',
      },
    },
  },
};
