// Keys for the 2026-09-06 "wire the unwired features" pass: the masked-export
// refusal, the equity cliff countdown, listing gates, the calendar's next-up line,
// advisory feeds, the person's legal agreements, RFP discard, collection read
// policy, the burn-rate widget, the runtime-surface refusal and the VoC inbox.
// Apply: node scripts/i18n-merge.mjs scripts/i18n-patch-unwired-features.mjs
export const PATCHES = {
  en: {
    creationCanvas: {
      exportUnmaskedColumns: 'Export refused: {columns} hold personal data and are not masked. Mask them on the card first.',
      founder: { field: { daysToCliff: 'Days to cliff' } },
      publish: {
        priceFreeOnly: 'This kind is always free to take.',
        deliveryHostedHint: 'Can be delivered hosted — buyers get a running copy, not files.',
      },
    },
    calendar: { nextUp: 'Next: {subject} · {when}' },
    security: {
      webAdvisoryFeeds: 'Advisory feeds',
      webAdvisoryConfigured: 'ready',
      webAdvisoryUnconfigured: 'not configured here',
      agreementsTab: 'Agreements',
      agreements: {
        title: 'Your agreements',
        description: 'What you have accepted, by version, and what is still outstanding.',
        loading: 'Loading your agreements…',
        error: 'Your agreements could not be loaded.',
        outstanding: 'Outstanding',
        accepted: 'Accepted v{version} on {date}',
        notRequired: 'Not required',
        kind: {
          terms: 'Terms of service',
          privacy: 'Privacy policy',
          dpa: 'Data processing agreement',
          aup: 'Acceptable use policy',
          nda: 'Non-disclosure agreement',
          cookie: 'Cookie policy',
        },
      },
    },
    rfpPage: {
      discard: 'Discard request',
      discardConfirm: 'Discard “{title}”? Its responses and risk register go with it.',
    },
    site: {
      forms: {
        readPolicy: 'Signed-in visitors can read back their own submissions',
        readPolicyHint: 'Off by default. Turn on for an app with accounts — “show me my orders” — and only rows a signed-in person submitted are ever returned to them.',
      },
    },
    components: { title: { finBurnRate: 'Burn & runway' } },
    insights: {
      fin: {
        runway: '{months} months of runway',
        burnUnavailable: 'No burn data yet',
        burnSub: 'monthly burn',
      },
    },
    cloudAgentForm: { errSurfaceBlocked: '{surface} is not available for this project — pick another runtime surface.' },
    feedback: {
      voc: {
        title: 'Customer feedback inbox',
        description: 'What your site’s feedback collectors gathered — your customers’ own words, triaged here.',
        filterLabel: 'Filter by status',
        status: { new: 'New', triaged: 'Triaged', dismissed: 'Dismissed' },
        loading: 'Loading feedback…',
        error: 'Feedback could not be loaded.',
        empty: 'Nothing here.',
        sentiment: 'sentiment {value}',
        markTriaged: 'Mark triaged',
        dismiss: 'Dismiss',
        reopen: 'Reopen',
      },
    },
  },
  zh: {
    creationCanvas: {
      exportUnmaskedColumns: '已拒绝导出：{columns} 包含个人数据且未脱敏。请先在卡片上脱敏。',
      founder: { field: { daysToCliff: '距悬崖期天数' } },
      publish: {
        priceFreeOnly: '此类型始终免费获取。',
        deliveryHostedHint: '可托管交付——买家获得运行中的副本，而非文件。',
      },
    },
    calendar: { nextUp: '下一项：{subject} · {when}' },
    security: {
      webAdvisoryFeeds: '安全通告源',
      webAdvisoryConfigured: '就绪',
      webAdvisoryUnconfigured: '此环境未配置',
      agreementsTab: '协议',
      agreements: {
        title: '你的协议',
        description: '你已接受的版本，以及仍待接受的内容。',
        loading: '正在加载你的协议…',
        error: '无法加载你的协议。',
        outstanding: '待接受',
        accepted: '已于 {date} 接受 v{version}',
        notRequired: '无需接受',
        kind: {
          terms: '服务条款',
          privacy: '隐私政策',
          dpa: '数据处理协议',
          aup: '可接受使用政策',
          nda: '保密协议',
          cookie: 'Cookie 政策',
        },
      },
    },
    rfpPage: {
      discard: '放弃请求',
      discardConfirm: '放弃“{title}”？其回复和风险登记将一并删除。',
    },
    site: {
      forms: {
        readPolicy: '已登录访客可读取自己提交的记录',
        readPolicyHint: '默认关闭。适用于带账户的应用——“查看我的订单”——只会返回该登录用户自己提交的记录。',
      },
    },
    components: { title: { finBurnRate: '烧钱率与跑道' } },
    insights: {
      fin: {
        runway: '剩余 {months} 个月跑道',
        burnUnavailable: '暂无烧钱率数据',
        burnSub: '每月烧钱',
      },
    },
    cloudAgentForm: { errSurfaceBlocked: '{surface} 在此项目不可用——请选择其他运行环境。' },
    feedback: {
      voc: {
        title: '客户反馈收件箱',
        description: '你网站的反馈收集器收集到的内容——客户的原话，在此分类处理。',
        filterLabel: '按状态筛选',
        status: { new: '新', triaged: '已分类', dismissed: '已忽略' },
        loading: '正在加载反馈…',
        error: '无法加载反馈。',
        empty: '暂无内容。',
        sentiment: '情感 {value}',
        markTriaged: '标记为已分类',
        dismiss: '忽略',
        reopen: '重新打开',
      },
    },
  },
  es: {
    creationCanvas: {
      exportUnmaskedColumns: 'Exportación rechazada: {columns} contienen datos personales sin enmascarar. Enmascáralas primero en la tarjeta.',
      founder: { field: { daysToCliff: 'Días hasta el cliff' } },
      publish: {
        priceFreeOnly: 'Este tipo siempre es gratuito.',
        deliveryHostedHint: 'Puede entregarse alojado: los compradores reciben una copia en ejecución, no archivos.',
      },
    },
    calendar: { nextUp: 'Siguiente: {subject} · {when}' },
    security: {
      webAdvisoryFeeds: 'Fuentes de avisos',
      webAdvisoryConfigured: 'lista',
      webAdvisoryUnconfigured: 'no configurada aquí',
      agreementsTab: 'Acuerdos',
      agreements: {
        title: 'Tus acuerdos',
        description: 'Lo que has aceptado, por versión, y lo que sigue pendiente.',
        loading: 'Cargando tus acuerdos…',
        error: 'No se pudieron cargar tus acuerdos.',
        outstanding: 'Pendiente',
        accepted: 'Aceptado v{version} el {date}',
        notRequired: 'No requerido',
        kind: {
          terms: 'Términos del servicio',
          privacy: 'Política de privacidad',
          dpa: 'Acuerdo de tratamiento de datos',
          aup: 'Política de uso aceptable',
          nda: 'Acuerdo de confidencialidad',
          cookie: 'Política de cookies',
        },
      },
    },
    rfpPage: {
      discard: 'Descartar solicitud',
      discardConfirm: '¿Descartar «{title}»? Sus respuestas y su registro de riesgos se eliminarán con ella.',
    },
    site: {
      forms: {
        readPolicy: 'Los visitantes con sesión pueden leer sus propios envíos',
        readPolicyHint: 'Desactivado por defecto. Actívalo para una app con cuentas («mis pedidos»): solo se devuelven las filas que envió esa persona.',
      },
    },
    components: { title: { finBurnRate: 'Burn rate y runway' } },
    insights: {
      fin: {
        runway: '{months} meses de runway',
        burnUnavailable: 'Aún no hay datos de burn rate',
        burnSub: 'gasto mensual',
      },
    },
    cloudAgentForm: { errSurfaceBlocked: '{surface} no está disponible para este proyecto: elige otra superficie de ejecución.' },
    feedback: {
      voc: {
        title: 'Bandeja de opiniones de clientes',
        description: 'Lo que recogieron los recolectores de tu sitio: las palabras de tus clientes, clasificadas aquí.',
        filterLabel: 'Filtrar por estado',
        status: { new: 'Nuevas', triaged: 'Clasificadas', dismissed: 'Descartadas' },
        loading: 'Cargando opiniones…',
        error: 'No se pudieron cargar las opiniones.',
        empty: 'Nada por aquí.',
        sentiment: 'sentimiento {value}',
        markTriaged: 'Marcar clasificada',
        dismiss: 'Descartar',
        reopen: 'Reabrir',
      },
    },
  },
  fr: {
    creationCanvas: {
      exportUnmaskedColumns: 'Export refusé : {columns} contiennent des données personnelles non masquées. Masquez-les d’abord sur la carte.',
      founder: { field: { daysToCliff: 'Jours avant le cliff' } },
      publish: {
        priceFreeOnly: 'Ce type est toujours gratuit.',
        deliveryHostedHint: 'Peut être livré hébergé : les acheteurs reçoivent une copie en marche, pas des fichiers.',
      },
    },
    calendar: { nextUp: 'Prochain : {subject} · {when}' },
    security: {
      webAdvisoryFeeds: 'Flux d’avis de sécurité',
      webAdvisoryConfigured: 'prêt',
      webAdvisoryUnconfigured: 'non configuré ici',
      agreementsTab: 'Accords',
      agreements: {
        title: 'Vos accords',
        description: 'Ce que vous avez accepté, par version, et ce qui reste en attente.',
        loading: 'Chargement de vos accords…',
        error: 'Impossible de charger vos accords.',
        outstanding: 'En attente',
        accepted: 'Accepté v{version} le {date}',
        notRequired: 'Non requis',
        kind: {
          terms: 'Conditions d’utilisation',
          privacy: 'Politique de confidentialité',
          dpa: 'Accord de traitement des données',
          aup: 'Politique d’usage acceptable',
          nda: 'Accord de confidentialité',
          cookie: 'Politique de cookies',
        },
      },
    },
    rfpPage: {
      discard: 'Abandonner la demande',
      discardConfirm: 'Abandonner « {title} » ? Ses réponses et son registre des risques partent avec elle.',
    },
    site: {
      forms: {
        readPolicy: 'Les visiteurs connectés peuvent relire leurs propres envois',
        readPolicyHint: 'Désactivé par défaut. À activer pour une app avec comptes (« mes commandes ») : seules les lignes envoyées par cette personne lui sont renvoyées.',
      },
    },
    components: { title: { finBurnRate: 'Burn rate et runway' } },
    insights: {
      fin: {
        runway: '{months} mois de runway',
        burnUnavailable: 'Pas encore de données de burn rate',
        burnSub: 'dépense mensuelle',
      },
    },
    cloudAgentForm: { errSurfaceBlocked: '{surface} n’est pas disponible pour ce projet : choisissez une autre surface d’exécution.' },
    feedback: {
      voc: {
        title: 'Boîte de retours clients',
        description: 'Ce que les collecteurs de votre site ont recueilli : les mots de vos clients, triés ici.',
        filterLabel: 'Filtrer par statut',
        status: { new: 'Nouveaux', triaged: 'Triés', dismissed: 'Écartés' },
        loading: 'Chargement des retours…',
        error: 'Impossible de charger les retours.',
        empty: 'Rien ici.',
        sentiment: 'sentiment {value}',
        markTriaged: 'Marquer trié',
        dismiss: 'Écarter',
        reopen: 'Rouvrir',
      },
    },
  },
  de: {
    creationCanvas: {
      exportUnmaskedColumns: 'Export abgelehnt: {columns} enthalten unmaskierte personenbezogene Daten. Maskieren Sie sie zuerst auf der Karte.',
      founder: { field: { daysToCliff: 'Tage bis zum Cliff' } },
      publish: {
        priceFreeOnly: 'Diese Art ist immer kostenlos.',
        deliveryHostedHint: 'Kann gehostet geliefert werden – Käufer erhalten eine laufende Kopie, keine Dateien.',
      },
    },
    calendar: { nextUp: 'Nächster Termin: {subject} · {when}' },
    security: {
      webAdvisoryFeeds: 'Advisory-Feeds',
      webAdvisoryConfigured: 'bereit',
      webAdvisoryUnconfigured: 'hier nicht konfiguriert',
      agreementsTab: 'Vereinbarungen',
      agreements: {
        title: 'Ihre Vereinbarungen',
        description: 'Was Sie akzeptiert haben, nach Version, und was noch aussteht.',
        loading: 'Ihre Vereinbarungen werden geladen…',
        error: 'Ihre Vereinbarungen konnten nicht geladen werden.',
        outstanding: 'Ausstehend',
        accepted: 'v{version} akzeptiert am {date}',
        notRequired: 'Nicht erforderlich',
        kind: {
          terms: 'Nutzungsbedingungen',
          privacy: 'Datenschutzerklärung',
          dpa: 'Auftragsverarbeitungsvertrag',
          aup: 'Richtlinie zur zulässigen Nutzung',
          nda: 'Geheimhaltungsvereinbarung',
          cookie: 'Cookie-Richtlinie',
        },
      },
    },
    rfpPage: {
      discard: 'Anfrage verwerfen',
      discardConfirm: '„{title}“ verwerfen? Antworten und Risikoregister werden mit gelöscht.',
    },
    site: {
      forms: {
        readPolicy: 'Angemeldete Besucher können ihre eigenen Einsendungen lesen',
        readPolicyHint: 'Standardmäßig aus. Für Apps mit Konten („meine Bestellungen“) einschalten – zurückgegeben werden nur Zeilen, die diese Person selbst eingereicht hat.',
      },
    },
    components: { title: { finBurnRate: 'Burn-Rate & Runway' } },
    insights: {
      fin: {
        runway: '{months} Monate Runway',
        burnUnavailable: 'Noch keine Burn-Rate-Daten',
        burnSub: 'monatlicher Burn',
      },
    },
    cloudAgentForm: { errSurfaceBlocked: '{surface} ist für dieses Projekt nicht verfügbar – wählen Sie eine andere Laufzeitumgebung.' },
    feedback: {
      voc: {
        title: 'Kundenfeedback-Eingang',
        description: 'Was die Feedback-Sammler Ihrer Website erfasst haben – die Worte Ihrer Kunden, hier sortiert.',
        filterLabel: 'Nach Status filtern',
        status: { new: 'Neu', triaged: 'Sortiert', dismissed: 'Verworfen' },
        loading: 'Feedback wird geladen…',
        error: 'Feedback konnte nicht geladen werden.',
        empty: 'Nichts vorhanden.',
        sentiment: 'Stimmung {value}',
        markTriaged: 'Als sortiert markieren',
        dismiss: 'Verwerfen',
        reopen: 'Wieder öffnen',
      },
    },
  },
};
