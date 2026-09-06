// i18n patch: the /import page becomes a real import over `/api/import`.
//
// The record kinds and their columns come from the api's IMPORT_DATASETS
// registry, so every column name gets a `field<Name>` label and every kind a
// `kind<Key>` label (api/src/presentation/routes/importRoutes.test.ts asserts
// the set against these catalogs). Plus the strings the rebuilt page needs —
// the kind picker, the type-driven cell errors, real batch progress and the
// server's verdict — and the Insights tab that finally links to the page.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-import-kinds.mjs

/** Column labels: [en, zh, es, fr, de] per registry column name. */
const FIELDS = {
  memberKind: ['Member kind', '成员类型', 'Tipo de miembro', 'Type de membre', 'Mitgliedstyp'],
  memberRef: ['Member reference', '成员编号', 'Referencia del miembro', 'Référence du membre', 'Mitgliedsreferenz'],
  memberName: ['Member name', '成员姓名', 'Nombre del miembro', 'Nom du membre', 'Mitgliedsname'],
  eventType: ['Event type', '事件类型', 'Tipo de evento', 'Type d’événement', 'Ereignistyp'],
  teamId: ['Team ID', '团队 ID', 'ID del equipo', 'ID de l’équipe', 'Team-ID'],
  effectiveOn: ['Effective on', '生效日期', 'Fecha efectiva', 'Date d’effet', 'Wirksam ab'],
  isVoluntary: ['Voluntary', '是否自愿', 'Voluntario', 'Volontaire', 'Freiwillig'],
  reason: ['Reason', '原因', 'Motivo', 'Motif', 'Grund'],
  reqTitle: ['Requisition title', '招聘职位', 'Título de la vacante', 'Intitulé du poste', 'Stellenbezeichnung'],
  priority: ['Priority', '优先级', 'Prioridad', 'Priorité', 'Priorität'],
  status: ['Status', '状态', 'Estado', 'Statut', 'Status'],
  openedOn: ['Opened on', '开放日期', 'Fecha de apertura', 'Date d’ouverture', 'Eröffnet am'],
  targetStartOn: ['Target start', '目标入职日期', 'Inicio previsto', 'Début visé', 'Geplanter Start'],
  filledOn: ['Filled on', '填补日期', 'Fecha de cobertura', 'Date de pourvoi', 'Besetzt am'],
  notes: ['Notes', '备注', 'Notas', 'Notes', 'Notizen'],
  fiscalYear: ['Fiscal year', '财年', 'Año fiscal', 'Exercice', 'Geschäftsjahr'],
  quarter: ['Quarter', '季度', 'Trimestre', 'Trimestre', 'Quartal'],
  category: ['Category', '类别', 'Categoría', 'Catégorie', 'Kategorie'],
  actualUsd: ['Actual (USD)', '实际支出（美元）', 'Real (USD)', 'Réel (USD)', 'Ist (USD)'],
  planUsd: ['Plan (USD)', '计划支出（美元）', 'Plan (USD)', 'Prévu (USD)', 'Plan (USD)'],
  source: ['Source', '来源', 'Origen', 'Source', 'Quelle'],
  revenueUsd: ['Revenue (USD)', '收入（美元）', 'Ingresos (USD)', 'Chiffre d’affaires (USD)', 'Umsatz (USD)'],
  fte: ['FTE', '全职当量', 'ETC', 'ETP', 'VZÄ'],
  externalRef: ['External reference', '外部编号', 'Referencia externa', 'Référence externe', 'Externe Referenz'],
  subject: ['Subject', '主题', 'Asunto', 'Objet', 'Betreff'],
  isBug: ['Is a bug', '是否为缺陷', 'Es un error', 'Est un bug', 'Ist ein Fehler'],
  customerRef: ['Customer reference', '客户编号', 'Referencia del cliente', 'Référence client', 'Kundenreferenz'],
  openedAt: ['Opened at', '开启时间', 'Abierto el', 'Ouvert le', 'Eröffnet um'],
  resolvedAt: ['Resolved at', '解决时间', 'Resuelto el', 'Résolu le', 'Gelöst um'],
  title: ['Title', '标题', 'Título', 'Titre', 'Titel'],
  severity: ['Severity', '严重程度', 'Gravedad', 'Gravité', 'Schweregrad'],
  isAlertOnly: ['Alert only', '仅告警', 'Solo alerta', 'Alerte seulement', 'Nur Alarm'],
  startedAt: ['Started at', '开始时间', 'Inicio', 'Début', 'Beginn'],
  impact: ['Impact', '影响', 'Impacto', 'Impact', 'Auswirkung'],
  rootCause: ['Root cause', '根本原因', 'Causa raíz', 'Cause première', 'Ursache'],
  postmortemUrl: ['Post-mortem URL', '复盘链接', 'URL del post-mortem', 'URL du post-mortem', 'Post-mortem-URL'],
  serviceName: ['Service name', '服务名称', 'Nombre del servicio', 'Nom du service', 'Dienstname'],
  periodDay: ['Day', '日期', 'Día', 'Jour', 'Tag'],
  uptimePct: ['Uptime (%)', '正常运行时间（%）', 'Disponibilidad (%)', 'Disponibilité (%)', 'Verfügbarkeit (%)'],
  downtimeMinutes: ['Downtime (minutes)', '停机时间（分钟）', 'Inactividad (minutos)', 'Indisponibilité (minutes)', 'Ausfallzeit (Minuten)'],
  toolName: ['Tool name', '工具名称', 'Nombre de la herramienta', 'Nom de l’outil', 'Werkzeugname'],
  periodMonth: ['Month', '月份', 'Mes', 'Mois', 'Monat'],
  activeUsers: ['Active users', '活跃用户', 'Usuarios activos', 'Utilisateurs actifs', 'Aktive Nutzer'],
  eligibleUsers: ['Eligible users', '可用用户', 'Usuarios elegibles', 'Utilisateurs éligibles', 'Berechtigte Nutzer'],
  estHoursSaved: ['Estimated hours saved', '预计节省工时', 'Horas ahorradas estimadas', 'Heures économisées (estimation)', 'Geschätzte eingesparte Stunden'],
  monthlyCostUsd: ['Monthly cost (USD)', '月成本（美元）', 'Coste mensual (USD)', 'Coût mensuel (USD)', 'Monatliche Kosten (USD)'],
  initiativeId: ['Initiative ID', '计划 ID', 'ID de la iniciativa', 'ID de l’initiative', 'Initiativen-ID'],
  programName: ['Program name', '项目名称', 'Nombre del programa', 'Nom du programme', 'Programmname'],
  tier: ['Tier', '层级', 'Nivel', 'Niveau', 'Stufe'],
  investedUsd: ['Invested (USD)', '投入（美元）', 'Invertido (USD)', 'Investi (USD)', 'Investiert (USD)'],
  objective: ['Objective', '目标', 'Objetivo', 'Objectif', 'Ziel'],
};

/** Kind labels: [en, zh, es, fr, de] per registry key, as `kind<Key>`. */
const KINDS = {
  kindHeadcountEvents: ['Headcount events', '人员变动事件', 'Eventos de plantilla', 'Événements d’effectif', 'Personalereignisse'],
  kindPositions: ['Open positions', '空缺职位', 'Vacantes', 'Postes ouverts', 'Offene Stellen'],
  kindRdFinancials: ['R&D financials', '研发财务', 'Finanzas de I+D', 'Finances R&D', 'F&E-Finanzen'],
  kindRdRevenue: ['R&D revenue', '研发收入', 'Ingresos de I+D', 'Chiffre d’affaires R&D', 'F&E-Umsatz'],
  kindRdFte: ['R&D FTE allocation', '研发人力分配', 'Asignación de ETC de I+D', 'Répartition ETP R&D', 'F&E-VZÄ-Zuordnung'],
  kindSupportTickets: ['Support tickets', '支持工单', 'Tickets de soporte', 'Tickets de support', 'Support-Tickets'],
  kindIncidents: ['Incidents', '事故', 'Incidentes', 'Incidents', 'Vorfälle'],
  kindUptime: ['Uptime samples', '可用性采样', 'Muestras de disponibilidad', 'Relevés de disponibilité', 'Verfügbarkeitsmessungen'],
  kindAiToolAdoption: ['AI tool adoption', 'AI 工具采用', 'Adopción de herramientas de IA', 'Adoption des outils d’IA', 'Einführung von KI-Tools'],
  kindAiPrograms: ['AI programs', 'AI 项目', 'Programas de IA', 'Programmes d’IA', 'KI-Programme'],
};

/** Page strings: [en, zh, es, fr, de]. */
const PAGE = {
  kindLabel: ['Record type', '记录类型', 'Tipo de registro', 'Type d’enregistrement', 'Datensatztyp'],
  kindHint: [
    'Each type is one board dataset. Its columns come from the server, so what you map here is exactly what it accepts.',
    '每种类型对应一个董事会数据集。其列由服务器提供，因此此处映射的正是它接受的内容。',
    'Cada tipo es un conjunto de datos del consejo. Sus columnas vienen del servidor, así que lo que asignes aquí es exactamente lo que acepta.',
    'Chaque type correspond à un jeu de données du conseil. Ses colonnes viennent du serveur : ce que vous associez ici est exactement ce qu’il accepte.',
    'Jeder Typ ist ein Board-Datensatz. Seine Spalten kommen vom Server, daher ist das, was Sie hier zuordnen, genau das, was er akzeptiert.',
  ],
  kindsLoading: ['Loading record types…', '正在加载记录类型…', 'Cargando tipos de registro…', 'Chargement des types d’enregistrement…', 'Datensatztypen werden geladen…'],
  kindsLoadFailed: ['The record types could not be loaded.', '无法加载记录类型。', 'No se pudieron cargar los tipos de registro.', 'Impossible de charger les types d’enregistrement.', 'Die Datensatztypen konnten nicht geladen werden.'],
  kindsRetry: ['Try again', '重试', 'Reintentar', 'Réessayer', 'Erneut versuchen'],
  kindsEmpty: ['There is nothing to import into yet.', '目前还没有可导入的目标。', 'Todavía no hay nada donde importar.', 'Il n’y a encore rien où importer.', 'Es gibt noch nichts, wohin importiert werden kann.'],
  fieldRequired: ['{field} is required.', '必须填写{field}。', '{field} es obligatorio.', '{field} est obligatoire.', '{field} ist erforderlich.'],
  fieldOptional: ['Optional', '可选', 'Opcional', 'Facultatif', 'Optional'],
  placeholderExample: ['e.g. {example}', '例如 {example}', 'p. ej. {example}', 'p. ex. {example}', 'z. B. {example}'],
  guidedSubmitSkipped: ['The server did not write this record:', '服务器未写入此记录：', 'El servidor no escribió este registro:', 'Le serveur n’a pas enregistré cet élément :', 'Der Server hat diesen Datensatz nicht geschrieben:'],
  guidedSuccessBodyKind: [
    'The record is in the workspace now. Here is what the server wrote.',
    '记录已进入工作区。以下是服务器写入的内容。',
    'El registro ya está en el espacio de trabajo. Esto es lo que escribió el servidor.',
    'L’enregistrement est maintenant dans l’espace de travail. Voici ce que le serveur a écrit.',
    'Der Datensatz ist jetzt im Arbeitsbereich. Das hat der Server geschrieben.',
  ],
  bulkErrorNotNumber: ['{field} must be a number.', '{field}必须是数字。', '{field} debe ser un número.', '{field} doit être un nombre.', '{field} muss eine Zahl sein.'],
  bulkErrorNotDate: [
    '{field} must be a date (YYYY-MM-DD or ISO 8601).',
    '{field}必须是日期（YYYY-MM-DD 或 ISO 8601）。',
    '{field} debe ser una fecha (AAAA-MM-DD o ISO 8601).',
    '{field} doit être une date (AAAA-MM-JJ ou ISO 8601).',
    '{field} muss ein Datum sein (JJJJ-MM-TT oder ISO 8601).',
  ],
  bulkRequiredUnmapped: [
    '{field} is required — map one of your columns to it.',
    '{field}为必填项——请将您的某一列映射到它。',
    '{field} es obligatorio: asigna una de tus columnas a este campo.',
    '{field} est obligatoire : associez-lui l’une de vos colonnes.',
    '{field} ist erforderlich – ordnen Sie ihm eine Ihrer Spalten zu.',
  ],
  bulkUnsupportedFile: [
    '.{ext} files cannot be imported. Use CSV, TSV or JSON.',
    '无法导入 .{ext} 文件。请使用 CSV、TSV 或 JSON。',
    'Los archivos .{ext} no se pueden importar. Usa CSV, TSV o JSON.',
    'Les fichiers .{ext} ne peuvent pas être importés. Utilisez CSV, TSV ou JSON.',
    '.{ext}-Dateien können nicht importiert werden. Verwenden Sie CSV, TSV oder JSON.',
  ],
  bulkImportingRows: [
    '{posted, number} of {total, number} rows posted',
    '已提交 {posted, number} / {total, number} 行',
    '{posted, number} de {total, number} filas enviadas',
    '{posted, number} lignes sur {total, number} envoyées',
    '{posted, number} von {total, number} Zeilen übermittelt',
  ],
  bulkCheckingServer: ['Checking the file with the server…', '正在与服务器核对文件…', 'Comprobando el archivo con el servidor…', 'Vérification du fichier auprès du serveur…', 'Datei wird mit dem Server geprüft…'],
  bulkServerErrorsTitle: ['Rows the server would skip', '服务器将跳过的行', 'Filas que el servidor omitiría', 'Lignes que le serveur ignorerait', 'Zeilen, die der Server überspringen würde'],
  bulkServerWouldInsert: ['Rows the server will write', '服务器将写入的行', 'Filas que el servidor escribirá', 'Lignes que le serveur enregistrera', 'Zeilen, die der Server schreiben wird'],
  bulkImportFailed: [
    'The import stopped: {message}. Rows already posted are kept.',
    '导入已中止：{message}。已提交的行将保留。',
    'La importación se detuvo: {message}. Las filas ya enviadas se conservan.',
    'L’import s’est arrêté : {message}. Les lignes déjà envoyées sont conservées.',
    'Der Import wurde abgebrochen: {message}. Bereits übermittelte Zeilen bleiben erhalten.',
  ],
  bulkNothingToImport: ['There are no valid rows to import.', '没有可导入的有效行。', 'No hay filas válidas para importar.', 'Aucune ligne valide à importer.', 'Es gibt keine gültigen Zeilen zum Importieren.'],
  resultErrorsTitle: ['What the server reported', '服务器的反馈', 'Lo que informó el servidor', 'Ce que le serveur a signalé', 'Was der Server gemeldet hat'],
  templateFor: ['Download the {kind} template', '下载{kind}模板', 'Descargar la plantilla de {kind}', 'Télécharger le modèle {kind}', 'Vorlage für {kind} herunterladen'],
};

const NAV_TAB = { import: ['Import', '导入', 'Importar', 'Importer', 'Importieren'] };

const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];
const pick = (table, i) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v[i]]));
const fieldKey = (name) => `field${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export const PATCHES = Object.fromEntries(LOCALES.map((loc, i) => [loc, {
  import: {
    ...Object.fromEntries(Object.entries(FIELDS).map(([name, v]) => [fieldKey(name), v[i]])),
    ...pick(KINDS, i),
    ...pick(PAGE, i),
  },
  nav: { tab: pick(NAV_TAB, i) },
}]));
