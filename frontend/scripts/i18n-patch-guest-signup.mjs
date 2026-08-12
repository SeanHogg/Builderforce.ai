// Guest conversion CTA (<GuestSignupCta>) — the shared "create a free account /
// sign in" block every guest surface now renders, plus the canvas notice for a
// shared guest room that has spent its combined allowance.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-guest-signup.mjs
export const PATCHES = {
  en: {
    common: {
      createFreeAccount: 'Create a free account',
      guestSignupTitle: "You're on a roll!",
    },
    creationCanvas: {
      noticeGuestLimitRoom: 'This shared session has used its {limit} free messages for today. Sign up free to keep going — your canvas comes with you.',
    },
  },
  zh: {
    common: {
      createFreeAccount: '创建免费账户',
      guestSignupTitle: '势头正好！',
    },
    creationCanvas: {
      noticeGuestLimitRoom: '此共享会话今天的 {limit} 条免费消息已用完。免费注册即可继续——您的画布会一并保留。',
    },
  },
  es: {
    common: {
      createFreeAccount: 'Crear una cuenta gratis',
      guestSignupTitle: '¡Vas a buen ritmo!',
    },
    creationCanvas: {
      noticeGuestLimitRoom: 'Esta sesión compartida ya usó sus {limit} mensajes gratuitos de hoy. Regístrate gratis para continuar: tu lienzo te acompaña.',
    },
  },
  fr: {
    common: {
      createFreeAccount: 'Créer un compte gratuit',
      guestSignupTitle: 'Vous êtes lancé !',
    },
    creationCanvas: {
      noticeGuestLimitRoom: 'Cette session partagée a utilisé ses {limit} messages gratuits du jour. Inscrivez-vous gratuitement pour continuer — votre canevas vous suit.',
    },
  },
  de: {
    common: {
      createFreeAccount: 'Kostenloses Konto erstellen',
      guestSignupTitle: 'Sie sind in Fahrt!',
    },
    creationCanvas: {
      noticeGuestLimitRoom: 'Diese geteilte Sitzung hat ihre {limit} kostenlosen Nachrichten für heute aufgebraucht. Melden Sie sich kostenlos an, um weiterzumachen – Ihr Canvas kommt mit.',
    },
  },
};
