// i18n patch: catalog adoption analytics + prompt version history/analyzer + FACTS library.
// Deep-merged (missing leaves only) into each messages/<locale>.json by i18n-merge.mjs.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-catalog.mjs

const build = (catalogAnalytics, promptHistory, promptsPage, factsPage) => ({
  catalogAnalytics,
  promptHistory,
  promptsPage,
  factsPage,
});

export const PATCHES = {
  en: build(
    { trendTitle: 'Adoption over time', installs: 'Installs', usage: 'Usage', window: 'Time window', days: '{n}d' },
    {
      title: 'Version history', loading: 'Loading versions…', from: 'From', to: 'To',
      versionN: 'v{n}', unified: 'Unified', split: 'Side by side',
      added: 'added', removed: 'removed', unchanged: '{n} unchanged',
      allVersions: 'All versions', empty: 'No versions yet',
    },
    {
      history: 'History', analyze: 'Analyze & improve', analyzing: 'Analyzing…',
      suggestionTitle: 'Suggested improvement', saveAsVersion: 'Save as new version',
      savedVersion: 'Saved ✓', copySuggestion: 'Copy',
    },
    {
      title: 'Facts', subtitle: 'A structured, queryable store of facts your workspace and agents can rely on.',
      newFact: 'New fact', editFact: 'Edit fact', searchPlaceholder: 'Search facts…',
      allSubjects: 'All subjects', allPredicates: 'All predicates', clear: 'Clear',
      loading: 'Loading…', empty: 'No facts yet.',
      colSubject: 'Subject', colPredicate: 'Predicate', colObject: 'Object', colSource: 'Source',
      colConfidence: 'Confidence', colActions: 'Actions',
      edit: 'Edit', delete: 'Delete', save: 'Save', saving: 'Saving…', cancel: 'Cancel',
      validation: 'Subject, predicate and object are required.',
      needDeveloper: 'Requires Developer role',
      subjectPlaceholder: 'e.g. Acme Corp', predicatePlaceholder: 'e.g. founded_in',
      objectPlaceholder: 'e.g. 2019', sourcePlaceholder: 'e.g. onboarding call',
    },
  ),
  zh: build(
    { trendTitle: '采用趋势', installs: '安装量', usage: '使用量', window: '时间范围', days: '{n}天' },
    {
      title: '版本历史', loading: '正在加载版本…', from: '起始', to: '目标',
      versionN: 'v{n}', unified: '统一视图', split: '并排对比',
      added: '新增', removed: '删除', unchanged: '{n} 行未变',
      allVersions: '所有版本', empty: '暂无版本',
    },
    {
      history: '历史', analyze: '分析并改进', analyzing: '正在分析…',
      suggestionTitle: '改进建议', saveAsVersion: '保存为新版本',
      savedVersion: '已保存 ✓', copySuggestion: '复制',
    },
    {
      title: '事实库', subtitle: '一个结构化、可查询的事实存储，供你的工作区和智能体使用。',
      newFact: '新建事实', editFact: '编辑事实', searchPlaceholder: '搜索事实…',
      allSubjects: '所有主语', allPredicates: '所有谓语', clear: '清除',
      loading: '加载中…', empty: '暂无事实。',
      colSubject: '主语', colPredicate: '谓语', colObject: '宾语', colSource: '来源',
      colConfidence: '置信度', colActions: '操作',
      edit: '编辑', delete: '删除', save: '保存', saving: '保存中…', cancel: '取消',
      validation: '主语、谓语和宾语为必填项。',
      needDeveloper: '需要开发者角色',
      subjectPlaceholder: '例如 Acme 公司', predicatePlaceholder: '例如 成立于',
      objectPlaceholder: '例如 2019', sourcePlaceholder: '例如 入职通话',
    },
  ),
  es: build(
    { trendTitle: 'Adopción a lo largo del tiempo', installs: 'Instalaciones', usage: 'Uso', window: 'Rango de tiempo', days: '{n} d' },
    {
      title: 'Historial de versiones', loading: 'Cargando versiones…', from: 'Desde', to: 'Hasta',
      versionN: 'v{n}', unified: 'Unificada', split: 'En paralelo',
      added: 'añadidas', removed: 'eliminadas', unchanged: '{n} sin cambios',
      allVersions: 'Todas las versiones', empty: 'Aún no hay versiones',
    },
    {
      history: 'Historial', analyze: 'Analizar y mejorar', analyzing: 'Analizando…',
      suggestionTitle: 'Mejora sugerida', saveAsVersion: 'Guardar como nueva versión',
      savedVersion: 'Guardado ✓', copySuggestion: 'Copiar',
    },
    {
      title: 'Hechos', subtitle: 'Un almacén estructurado y consultable de hechos en el que tu espacio y tus agentes pueden confiar.',
      newFact: 'Nuevo hecho', editFact: 'Editar hecho', searchPlaceholder: 'Buscar hechos…',
      allSubjects: 'Todos los sujetos', allPredicates: 'Todos los predicados', clear: 'Limpiar',
      loading: 'Cargando…', empty: 'Aún no hay hechos.',
      colSubject: 'Sujeto', colPredicate: 'Predicado', colObject: 'Objeto', colSource: 'Fuente',
      colConfidence: 'Confianza', colActions: 'Acciones',
      edit: 'Editar', delete: 'Eliminar', save: 'Guardar', saving: 'Guardando…', cancel: 'Cancelar',
      validation: 'El sujeto, el predicado y el objeto son obligatorios.',
      needDeveloper: 'Requiere el rol de Desarrollador',
      subjectPlaceholder: 'p. ej. Acme Corp', predicatePlaceholder: 'p. ej. fundada_en',
      objectPlaceholder: 'p. ej. 2019', sourcePlaceholder: 'p. ej. llamada de incorporación',
    },
  ),
  fr: build(
    { trendTitle: 'Adoption au fil du temps', installs: 'Installations', usage: 'Utilisation', window: 'Période', days: '{n} j' },
    {
      title: 'Historique des versions', loading: 'Chargement des versions…', from: 'De', to: 'À',
      versionN: 'v{n}', unified: 'Unifiée', split: 'Côte à côte',
      added: 'ajoutées', removed: 'supprimées', unchanged: '{n} inchangées',
      allVersions: 'Toutes les versions', empty: 'Aucune version pour le moment',
    },
    {
      history: 'Historique', analyze: 'Analyser et améliorer', analyzing: 'Analyse…',
      suggestionTitle: 'Amélioration suggérée', saveAsVersion: 'Enregistrer comme nouvelle version',
      savedVersion: 'Enregistré ✓', copySuggestion: 'Copier',
    },
    {
      title: 'Faits', subtitle: "Un stock structuré et interrogeable de faits sur lequel votre espace et vos agents peuvent s'appuyer.",
      newFact: 'Nouveau fait', editFact: 'Modifier le fait', searchPlaceholder: 'Rechercher des faits…',
      allSubjects: 'Tous les sujets', allPredicates: 'Tous les prédicats', clear: 'Effacer',
      loading: 'Chargement…', empty: 'Aucun fait pour le moment.',
      colSubject: 'Sujet', colPredicate: 'Prédicat', colObject: 'Objet', colSource: 'Source',
      colConfidence: 'Confiance', colActions: 'Actions',
      edit: 'Modifier', delete: 'Supprimer', save: 'Enregistrer', saving: 'Enregistrement…', cancel: 'Annuler',
      validation: 'Le sujet, le prédicat et l’objet sont obligatoires.',
      needDeveloper: 'Nécessite le rôle Développeur',
      subjectPlaceholder: 'ex. Acme Corp', predicatePlaceholder: 'ex. fondée_en',
      objectPlaceholder: 'ex. 2019', sourcePlaceholder: 'ex. appel d’intégration',
    },
  ),
  de: build(
    { trendTitle: 'Akzeptanz im Zeitverlauf', installs: 'Installationen', usage: 'Nutzung', window: 'Zeitraum', days: '{n} T' },
    {
      title: 'Versionsverlauf', loading: 'Versionen werden geladen…', from: 'Von', to: 'Bis',
      versionN: 'v{n}', unified: 'Vereinheitlicht', split: 'Nebeneinander',
      added: 'hinzugefügt', removed: 'entfernt', unchanged: '{n} unverändert',
      allVersions: 'Alle Versionen', empty: 'Noch keine Versionen',
    },
    {
      history: 'Verlauf', analyze: 'Analysieren & verbessern', analyzing: 'Analysiere…',
      suggestionTitle: 'Verbesserungsvorschlag', saveAsVersion: 'Als neue Version speichern',
      savedVersion: 'Gespeichert ✓', copySuggestion: 'Kopieren',
    },
    {
      title: 'Fakten', subtitle: 'Ein strukturierter, abfragbarer Speicher von Fakten, auf den sich Ihr Workspace und Ihre Agenten verlassen können.',
      newFact: 'Neuer Fakt', editFact: 'Fakt bearbeiten', searchPlaceholder: 'Fakten suchen…',
      allSubjects: 'Alle Subjekte', allPredicates: 'Alle Prädikate', clear: 'Zurücksetzen',
      loading: 'Wird geladen…', empty: 'Noch keine Fakten.',
      colSubject: 'Subjekt', colPredicate: 'Prädikat', colObject: 'Objekt', colSource: 'Quelle',
      colConfidence: 'Konfidenz', colActions: 'Aktionen',
      edit: 'Bearbeiten', delete: 'Löschen', save: 'Speichern', saving: 'Speichern…', cancel: 'Abbrechen',
      validation: 'Subjekt, Prädikat und Objekt sind erforderlich.',
      needDeveloper: 'Erfordert die Entwickler-Rolle',
      subjectPlaceholder: 'z. B. Acme Corp', predicatePlaceholder: 'z. B. gegründet_am',
      objectPlaceholder: 'z. B. 2019', sourcePlaceholder: 'z. B. Onboarding-Anruf',
    },
  ),
};
