/**
 * What `check-i18n-keys` still wanted after the locale-bundle repair, plus the
 * strings the page-scale document editor added.
 *
 * Three groups, and each was a different way of shipping a raw key:
 *
 *   - `creationCanvas.surface.calendar.*` — the calendar surface landed with NO
 *     namespace at all, so the rail read `creationCanvas.surface.calendar.label`
 *     and the month view read `…regionLabel` where its own labels belong.
 *   - `creationCanvas.node.campaign*` and `creationCanvas.brandClaimViolation` —
 *     call sites written against keys nobody added.
 *   - `creationCanvas.editor.*` — the new controls: heading 4, list nesting, a
 *     picture, a table, and the status bar's counts.
 */
export const PATCHES = {
  en: {
    creationCanvas: {
      brandClaimViolation: 'This makes a claim the brand forbids: {claims}',
      editor: {
        blockHeading4: 'Heading 4',
        indent: 'Increase indent',
        outdent: 'Decrease indent',
        image: 'Insert picture',
        imageUrl: 'Picture address',
        imagePlaceholder: 'https://example.com/picture.png',
        table: 'Insert table',
        tableColumn: 'Column {index}',
        insertApply: 'Insert',
        words: '{count, plural, =0 {no words} one {# word} other {# words}}',
        characters: '{count, plural, =0 {no characters} one {# character} other {# characters}}',
      },
      node: {
        campaignSendable: 'Sendable',
        campaignConsent: 'Consent',
        campaignConsentOk: 'Clear to send',
        campaignConsentBlocked: 'Blocked',
        campaignBlocker: {
          noAudience: 'No audience is bound to this campaign',
          unknownConsent: 'The lawful basis for mailing this audience is not recorded',
          noSuppressionCheck: 'The suppression list has not been checked',
          emptyAfterSuppression: 'Nobody is left once suppressions are removed',
          forbiddenClaim: 'The copy makes a claim the brand forbids',
        },
      },
      surface: {
        calendar: {
          label: 'Calendar',
          enter: 'Plan the month',
          active: 'You are in the calendar',
          open: 'Open the calendar',
          regionLabel: 'This canvas, read as one month',
          navLabel: 'Which month',
          previousMonth: 'Previous month',
          nextMonth: 'Next month',
          summary: '{scheduled} scheduled · {dated} dated · {undated} with no date',
          gridLabel: 'The days of this month',
          conflict: 'Another commitment shares this day',
        },
      },
    },
    ceremony: { nextSpeaker: 'Next', completeSession: 'Complete' },
  },
  zh: {
    creationCanvas: {
      brandClaimViolation: '其中包含品牌禁止的说法：{claims}',
      editor: {
        blockHeading4: '标题 4',
        indent: '增加缩进',
        outdent: '减少缩进',
        image: '插入图片',
        imageUrl: '图片地址',
        imagePlaceholder: 'https://example.com/picture.png',
        table: '插入表格',
        tableColumn: '第 {index} 列',
        insertApply: '插入',
        words: '{count, plural, =0 {没有字词} other {# 个字词}}',
        characters: '{count, plural, =0 {没有字符} other {# 个字符}}',
      },
      node: {
        campaignSendable: '可发送',
        campaignConsent: '同意状态',
        campaignConsentOk: '可以发送',
        campaignConsentBlocked: '已阻止',
        campaignBlocker: {
          noAudience: '此营销活动尚未绑定受众',
          unknownConsent: '未记录向该受众发送邮件的合法依据',
          noSuppressionCheck: '尚未核对屏蔽名单',
          emptyAfterSuppression: '剔除屏蔽名单后已无收件人',
          forbiddenClaim: '文案中含有品牌禁止的说法',
        },
      },
      surface: {
        calendar: {
          label: '日历',
          enter: '规划本月',
          active: '你正在日历中',
          open: '打开日历',
          regionLabel: '把这块画布作为一个月来查看',
          navLabel: '选择月份',
          previousMonth: '上一个月',
          nextMonth: '下一个月',
          summary: '{scheduled} 已排期 · {dated} 有日期 · {undated} 无日期',
          gridLabel: '本月的日期',
          conflict: '同一天还有另一项安排',
        },
      },
    },
    ceremony: { nextSpeaker: '下一位', completeSession: '结束' },
  },
  es: {
    creationCanvas: {
      brandClaimViolation: 'Esto incluye una afirmación que la marca prohíbe: {claims}',
      editor: {
        blockHeading4: 'Encabezado 4',
        indent: 'Aumentar sangría',
        outdent: 'Reducir sangría',
        image: 'Insertar imagen',
        imageUrl: 'Dirección de la imagen',
        imagePlaceholder: 'https://example.com/picture.png',
        table: 'Insertar tabla',
        tableColumn: 'Columna {index}',
        insertApply: 'Insertar',
        words: '{count, plural, =0 {sin palabras} one {# palabra} other {# palabras}}',
        characters: '{count, plural, =0 {sin caracteres} one {# carácter} other {# caracteres}}',
      },
      node: {
        campaignSendable: 'Enviables',
        campaignConsent: 'Consentimiento',
        campaignConsentOk: 'Listo para enviar',
        campaignConsentBlocked: 'Bloqueado',
        campaignBlocker: {
          noAudience: 'No hay ninguna audiencia vinculada a esta campaña',
          unknownConsent: 'No consta la base legal para escribir a esta audiencia',
          noSuppressionCheck: 'No se ha comprobado la lista de exclusión',
          emptyAfterSuppression: 'No queda nadie tras aplicar las exclusiones',
          forbiddenClaim: 'El texto incluye una afirmación que la marca prohíbe',
        },
      },
      surface: {
        calendar: {
          label: 'Calendario',
          enter: 'Planifica el mes',
          active: 'Estás en el calendario',
          open: 'Abrir el calendario',
          regionLabel: 'Este lienzo, leído como un mes',
          navLabel: 'Qué mes',
          previousMonth: 'Mes anterior',
          nextMonth: 'Mes siguiente',
          summary: '{scheduled} programados · {dated} con fecha · {undated} sin fecha',
          gridLabel: 'Los días de este mes',
          conflict: 'Otro compromiso comparte este día',
        },
      },
    },
    ceremony: { nextSpeaker: 'Siguiente', completeSession: 'Finalizar' },
  },
  fr: {
    creationCanvas: {
      brandClaimViolation: 'Ceci avance une affirmation que la marque interdit : {claims}',
      editor: {
        blockHeading4: 'Titre 4',
        indent: 'Augmenter le retrait',
        outdent: 'Diminuer le retrait',
        image: 'Insérer une image',
        imageUrl: 'Adresse de l’image',
        imagePlaceholder: 'https://example.com/picture.png',
        table: 'Insérer un tableau',
        tableColumn: 'Colonne {index}',
        insertApply: 'Insérer',
        words: '{count, plural, =0 {aucun mot} one {# mot} other {# mots}}',
        characters: '{count, plural, =0 {aucun caractère} one {# caractère} other {# caractères}}',
      },
      node: {
        campaignSendable: 'Envoyables',
        campaignConsent: 'Consentement',
        campaignConsentOk: 'Prêt à envoyer',
        campaignConsentBlocked: 'Bloqué',
        campaignBlocker: {
          noAudience: 'Aucune audience n’est rattachée à cette campagne',
          unknownConsent: 'La base légale pour écrire à cette audience n’est pas enregistrée',
          noSuppressionCheck: 'La liste d’exclusion n’a pas été vérifiée',
          emptyAfterSuppression: 'Il ne reste personne une fois les exclusions retirées',
          forbiddenClaim: 'Le texte avance une affirmation que la marque interdit',
        },
      },
      surface: {
        calendar: {
          label: 'Calendrier',
          enter: 'Planifier le mois',
          active: 'Vous êtes dans le calendrier',
          open: 'Ouvrir le calendrier',
          regionLabel: 'Ce canevas, lu comme un mois',
          navLabel: 'Quel mois',
          previousMonth: 'Mois précédent',
          nextMonth: 'Mois suivant',
          summary: '{scheduled} programmés · {dated} datés · {undated} sans date',
          gridLabel: 'Les jours de ce mois',
          conflict: 'Un autre engagement occupe ce jour',
        },
      },
    },
    ceremony: { nextSpeaker: 'Suivant', completeSession: 'Terminer' },
  },
  de: {
    creationCanvas: {
      brandClaimViolation: 'Das enthält eine Aussage, die die Marke verbietet: {claims}',
      editor: {
        blockHeading4: 'Überschrift 4',
        indent: 'Einzug vergrößern',
        outdent: 'Einzug verkleinern',
        image: 'Bild einfügen',
        imageUrl: 'Bildadresse',
        imagePlaceholder: 'https://example.com/picture.png',
        table: 'Tabelle einfügen',
        tableColumn: 'Spalte {index}',
        insertApply: 'Einfügen',
        words: '{count, plural, =0 {keine Wörter} one {# Wort} other {# Wörter}}',
        characters: '{count, plural, =0 {keine Zeichen} one {# Zeichen} other {# Zeichen}}',
      },
      node: {
        campaignSendable: 'Versendbar',
        campaignConsent: 'Einwilligung',
        campaignConsentOk: 'Versandbereit',
        campaignConsentBlocked: 'Blockiert',
        campaignBlocker: {
          noAudience: 'Dieser Kampagne ist keine Zielgruppe zugeordnet',
          unknownConsent: 'Die Rechtsgrundlage für den Versand an diese Zielgruppe ist nicht erfasst',
          noSuppressionCheck: 'Die Sperrliste wurde nicht geprüft',
          emptyAfterSuppression: 'Nach Abzug der Sperrliste bleibt niemand übrig',
          forbiddenClaim: 'Der Text enthält eine Aussage, die die Marke verbietet',
        },
      },
      surface: {
        calendar: {
          label: 'Kalender',
          enter: 'Den Monat planen',
          active: 'Du bist im Kalender',
          open: 'Kalender öffnen',
          regionLabel: 'Diese Arbeitsfläche, als ein Monat gelesen',
          navLabel: 'Welcher Monat',
          previousMonth: 'Voriger Monat',
          nextMonth: 'Nächster Monat',
          summary: '{scheduled} geplant · {dated} mit Datum · {undated} ohne Datum',
          gridLabel: 'Die Tage dieses Monats',
          conflict: 'An diesem Tag liegt bereits etwas anderes',
        },
      },
    },
    ceremony: { nextSpeaker: 'Weiter', completeSession: 'Abschließen' },
  },
};
