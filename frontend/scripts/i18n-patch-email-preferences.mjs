// i18n patch: /settings?sub=email — email language + lifecycle-mail consent.
//
// Wording note that matters across all five locales: the "always on" group is
// TRANSACTIONAL mail (sign-in links, verification codes, invitations, security
// notices). Every translation must keep it clear these are NOT opt-out-able and
// that switching everything off still leaves them arriving — otherwise a user
// unsubscribes expecting silence and then reports their password reset as a bug.

const t = (v) => ({ settings: { emailTab: v.emailTab, emailPrefs: v.prefs } });

export const PATCHES = {
  en: t({
    emailTab: 'Email',
    prefs: {
      title: 'Email preferences',
      whatWeSend: 'What we send',
      error: 'Could not update your email preferences. Please try again.',

      language: 'Email language',
      languageAuto: 'Auto-detect',
      languageHelp: 'The language we write your emails in. Independent of the app language above.',
      languageTitle: 'Language',
      languageDetail: 'We write to you in this language. If it is set to auto-detect we use the language '
        + 'you signed up in, falling back to English.',

      optionalTitle: 'Optional email',
      optionalHelp: 'Turn off anything you would rather not receive.',
      optionalDetail: 'These are the emails we choose to send. You can switch each one off, and every '
        + 'one of them carries an unsubscribe link.',

      productUpdates: 'Product updates',
      productUpdatesHelp: 'New features and notable changes.',
      onboardingTips: 'Tips and guides',
      onboardingTipsHelp: 'Occasional pointers on getting more out of Builderforce.',
      digests: 'Summaries and digests',
      digestsHelp: 'Periodic roundups of activity across your projects.',

      alwaysOnTitle: 'Always sent',
      alwaysOnBody: 'These emails are part of your account. They are never suppressed, even if you '
        + 'unsubscribe from everything else.',
      alwaysOn: {
        signIn: 'Sign-in links and magic links',
        verification: 'Email verification codes',
        invites: 'Workspace and chat invitations',
        security: 'Security and account-access notices',
      },

      transactionalNote: 'Account and security emails are always sent — they are part of how your '
        + 'account works, so they are not listed above.',

      unsubscribedTitle: 'You are unsubscribed',
      unsubscribedBody: 'You are not receiving any optional email. Account and security messages are '
        + 'still sent.',
      resubscribeCta: 'Resubscribe',
      resubscribeTitle: 'Resubscribe to optional email',
      resubscribeConfirm: 'You will start receiving optional email again, based on the categories you '
        + 'have switched on. Continue?',
    },
  }),

  zh: t({
    emailTab: '邮件',
    prefs: {
      title: '邮件偏好设置',
      whatWeSend: '我们会发送什么',
      error: '无法更新您的邮件偏好设置，请重试。',

      language: '邮件语言',
      languageAuto: '自动检测',
      languageHelp: '我们撰写邮件所使用的语言。与上方的应用界面语言相互独立。',
      languageTitle: '语言',
      languageDetail: '我们会使用该语言与您联系。若设置为自动检测，则使用您注册时所用的语言，'
        + '无法确定时回退为英语。',

      optionalTitle: '可选邮件',
      optionalHelp: '关闭您不希望收到的内容。',
      optionalDetail: '这些是由我们主动发送的邮件。您可以逐项关闭，并且每一封都附有退订链接。',

      productUpdates: '产品动态',
      productUpdatesHelp: '新功能与重要变更。',
      onboardingTips: '使用技巧与指南',
      onboardingTipsHelp: '偶尔提供的建议，帮助您更好地使用 Builderforce。',
      digests: '摘要与汇总',
      digestsHelp: '定期汇总您各个项目中的动态。',

      alwaysOnTitle: '始终发送',
      alwaysOnBody: '这些邮件属于您账户的组成部分。即使您退订了其他所有邮件，它们仍会照常发送。',
      alwaysOn: {
        signIn: '登录链接与免密登录链接',
        verification: '邮箱验证码',
        invites: '工作区与对话邀请',
        security: '安全与账户访问通知',
      },

      transactionalNote: '账户与安全类邮件始终会发送——它们是账户正常运作的一部分，因此未列在上方。',

      unsubscribedTitle: '您已退订',
      unsubscribedBody: '您当前不会收到任何可选邮件。账户与安全相关的通知仍会发送。',
      resubscribeCta: '重新订阅',
      resubscribeTitle: '重新订阅可选邮件',
      resubscribeConfirm: '您将根据已开启的类别重新开始接收可选邮件。是否继续？',
    },
  }),

  es: t({
    emailTab: 'Correo',
    prefs: {
      title: 'Preferencias de correo',
      whatWeSend: 'Qué enviamos',
      error: 'No se han podido actualizar tus preferencias de correo. Inténtalo de nuevo.',

      language: 'Idioma del correo',
      languageAuto: 'Detección automática',
      languageHelp: 'El idioma en el que te escribimos. Independiente del idioma de la aplicación de arriba.',
      languageTitle: 'Idioma',
      languageDetail: 'Te escribimos en este idioma. Si está en detección automática usamos el idioma '
        + 'con el que te registraste y, si no, el inglés.',

      optionalTitle: 'Correo opcional',
      optionalHelp: 'Desactiva lo que prefieras no recibir.',
      optionalDetail: 'Estos son los correos que decidimos enviar. Puedes desactivar cada uno, y todos '
        + 'incluyen un enlace para darse de baja.',

      productUpdates: 'Novedades del producto',
      productUpdatesHelp: 'Nuevas funciones y cambios destacados.',
      onboardingTips: 'Consejos y guías',
      onboardingTipsHelp: 'Sugerencias ocasionales para sacar más partido a Builderforce.',
      digests: 'Resúmenes y boletines',
      digestsHelp: 'Recopilaciones periódicas de la actividad de tus proyectos.',

      alwaysOnTitle: 'Siempre se envían',
      alwaysOnBody: 'Estos correos forman parte de tu cuenta. Nunca se suprimen, aunque te des de baja '
        + 'de todo lo demás.',
      alwaysOn: {
        signIn: 'Enlaces de acceso y enlaces mágicos',
        verification: 'Códigos de verificación de correo',
        invites: 'Invitaciones a espacios de trabajo y chats',
        security: 'Avisos de seguridad y de acceso a la cuenta',
      },

      transactionalNote: 'Los correos de cuenta y seguridad siempre se envían: forman parte del '
        + 'funcionamiento de tu cuenta, por eso no aparecen arriba.',

      unsubscribedTitle: 'Te has dado de baja',
      unsubscribedBody: 'No estás recibiendo ningún correo opcional. Los mensajes de cuenta y seguridad '
        + 'se siguen enviando.',
      resubscribeCta: 'Volver a suscribirme',
      resubscribeTitle: 'Volver a suscribirte al correo opcional',
      resubscribeConfirm: 'Volverás a recibir correo opcional según las categorías que tengas activadas. '
        + '¿Continuar?',
    },
  }),

  fr: t({
    emailTab: 'E-mail',
    prefs: {
      title: 'Préférences d’e-mail',
      whatWeSend: 'Ce que nous envoyons',
      error: 'Impossible de mettre à jour vos préférences d’e-mail. Veuillez réessayer.',

      language: 'Langue des e-mails',
      languageAuto: 'Détection automatique',
      languageHelp: 'La langue dans laquelle nous vous écrivons. Indépendante de la langue de '
        + 'l’application ci-dessus.',
      languageTitle: 'Langue',
      languageDetail: 'Nous vous écrivons dans cette langue. En détection automatique, nous utilisons '
        + 'la langue de votre inscription, à défaut l’anglais.',

      optionalTitle: 'E-mails facultatifs',
      optionalHelp: 'Désactivez ce que vous préférez ne pas recevoir.',
      optionalDetail: 'Ce sont les e-mails que nous choisissons d’envoyer. Vous pouvez les désactiver '
        + 'un par un, et chacun contient un lien de désabonnement.',

      productUpdates: 'Nouveautés produit',
      productUpdatesHelp: 'Nouvelles fonctionnalités et changements notables.',
      onboardingTips: 'Conseils et guides',
      onboardingTipsHelp: 'Quelques conseils de temps en temps pour tirer plus de Builderforce.',
      digests: 'Résumés et récapitulatifs',
      digestsHelp: 'Récapitulatifs réguliers de l’activité de vos projets.',

      alwaysOnTitle: 'Toujours envoyés',
      alwaysOnBody: 'Ces e-mails font partie de votre compte. Ils ne sont jamais supprimés, même si '
        + 'vous vous désabonnez de tout le reste.',
      alwaysOn: {
        signIn: 'Liens de connexion et liens magiques',
        verification: 'Codes de vérification d’e-mail',
        invites: 'Invitations aux espaces de travail et aux conversations',
        security: 'Avis de sécurité et d’accès au compte',
      },

      transactionalNote: 'Les e-mails de compte et de sécurité sont toujours envoyés — ils font partie '
        + 'du fonctionnement de votre compte et ne figurent donc pas ci-dessus.',

      unsubscribedTitle: 'Vous êtes désabonné',
      unsubscribedBody: 'Vous ne recevez aucun e-mail facultatif. Les messages de compte et de sécurité '
        + 'continuent d’être envoyés.',
      resubscribeCta: 'Se réabonner',
      resubscribeTitle: 'Se réabonner aux e-mails facultatifs',
      resubscribeConfirm: 'Vous recevrez de nouveau les e-mails facultatifs, selon les catégories que '
        + 'vous avez activées. Continuer ?',
    },
  }),

  de: t({
    emailTab: 'E-Mail',
    prefs: {
      title: 'E-Mail-Einstellungen',
      whatWeSend: 'Was wir senden',
      error: 'Ihre E-Mail-Einstellungen konnten nicht aktualisiert werden. Bitte versuchen Sie es erneut.',

      language: 'E-Mail-Sprache',
      languageAuto: 'Automatisch erkennen',
      languageHelp: 'Die Sprache, in der wir Ihnen schreiben. Unabhängig von der App-Sprache oben.',
      languageTitle: 'Sprache',
      languageDetail: 'Wir schreiben Ihnen in dieser Sprache. Bei automatischer Erkennung verwenden wir '
        + 'die Sprache Ihrer Registrierung, ersatzweise Englisch.',

      optionalTitle: 'Optionale E-Mails',
      optionalHelp: 'Schalten Sie ab, was Sie nicht erhalten möchten.',
      optionalDetail: 'Das sind die E-Mails, die wir von uns aus senden. Sie können jede einzeln '
        + 'abschalten, und jede enthält einen Abmeldelink.',

      productUpdates: 'Produkt-Neuigkeiten',
      productUpdatesHelp: 'Neue Funktionen und wichtige Änderungen.',
      onboardingTips: 'Tipps und Anleitungen',
      onboardingTipsHelp: 'Gelegentliche Hinweise, wie Sie mehr aus Builderforce herausholen.',
      digests: 'Zusammenfassungen und Übersichten',
      digestsHelp: 'Regelmäßige Übersichten der Aktivitäten in Ihren Projekten.',

      alwaysOnTitle: 'Werden immer gesendet',
      alwaysOnBody: 'Diese E-Mails gehören zu Ihrem Konto. Sie werden nie unterdrückt, auch wenn Sie '
        + 'sich von allem anderen abmelden.',
      alwaysOn: {
        signIn: 'Anmeldelinks und Magic Links',
        verification: 'E-Mail-Bestätigungscodes',
        invites: 'Einladungen zu Arbeitsbereichen und Chats',
        security: 'Sicherheits- und Kontozugriffshinweise',
      },

      transactionalNote: 'Konto- und Sicherheits-E-Mails werden immer gesendet — sie gehören zur '
        + 'Funktionsweise Ihres Kontos und sind deshalb oben nicht aufgeführt.',

      unsubscribedTitle: 'Sie sind abgemeldet',
      unsubscribedBody: 'Sie erhalten keine optionalen E-Mails. Konto- und Sicherheitsnachrichten werden '
        + 'weiterhin gesendet.',
      resubscribeCta: 'Erneut anmelden',
      resubscribeTitle: 'Optionale E-Mails wieder abonnieren',
      resubscribeConfirm: 'Sie erhalten wieder optionale E-Mails, entsprechend den von Ihnen aktivierten '
        + 'Kategorien. Fortfahren?',
    },
  }),
};
