// The invitation a signed-out visitor sees where a read that needs an account
// would have rendered (<GuestAccountPrompt>), in place of the raw 401 text.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-guest-wall.mjs
export const PATCHES = {
  en: {
    guest: {
      wall: {
        title: 'This view is yours once you have an account',
        body: 'You are exploring Builderforce as a guest. Create a free account to see your own projects, team and agents here — and to keep everything you make.',
      },
    },
  },
  zh: {
    guest: {
      wall: {
        title: '创建账户后，这个视图就是您的',
        body: '您正以访客身份浏览 Builderforce。创建免费账户即可在这里查看您自己的项目、团队和智能体，并保留您创作的一切。',
      },
    },
  },
  es: {
    guest: {
      wall: {
        title: 'Esta vista será tuya en cuanto tengas una cuenta',
        body: 'Estás explorando Builderforce como invitado. Crea una cuenta gratis para ver aquí tus propios proyectos, equipo y agentes, y para conservar todo lo que hagas.',
      },
    },
  },
  fr: {
    guest: {
      wall: {
        title: 'Cette vue sera la vôtre dès que vous aurez un compte',
        body: 'Vous explorez Builderforce en tant qu’invité. Créez un compte gratuit pour voir ici vos propres projets, votre équipe et vos agents — et pour conserver tout ce que vous créez.',
      },
    },
  },
  de: {
    guest: {
      wall: {
        title: 'Diese Ansicht gehört Ihnen, sobald Sie ein Konto haben',
        body: 'Sie erkunden Builderforce als Gast. Erstellen Sie ein kostenloses Konto, um hier Ihre eigenen Projekte, Ihr Team und Ihre Agenten zu sehen – und alles zu behalten, was Sie erstellen.',
      },
    },
  },
};
