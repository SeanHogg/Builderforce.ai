// i18n patch: EMP feature lenses — cross-team benchmarking (EMP-5), delay taxonomy
// (EMP-9), release picker (EMP-10a), pulse survey (EMP-15), export menu (EMP-20),
// and R&D reconciliation. All keys land under the `insights.emp.*` namespace so the
// new lenses/components read them via useTranslations('insights.emp').
// `emp` → the emp.* namespace used by the new components. `delivhub` → the two new
// Delivery-hub panel title/desc keys (crossTeam, delayTaxonomy) so registering them
// in deliveryPanels.tsx is turnkey (the hub reads titleKey via insights.delivhub).
const build = (emp, delivhub) => ({ insights: { emp, delivhub } });

export const PATCHES = {
  en: build({
    loading: 'Loading…',
    crossTeam: {
      noTeams: 'No teams yet', noData: 'No comparable teams', leaderboard: 'Team standing',
      footnote: 'Percentiles rank each team against the tenant’s other teams over the window.',
      tableTitle: 'Team metrics', team: 'Team', members: 'Members', overall: 'Overall',
      metric: { throughput: 'Throughput', avg_cycle_time_hours: 'Cycle time', rework_rate_pct: 'Rework', effectiveness: 'Effectiveness' },
    },
    delay: {
      taggedTasks: 'Tagged tasks', manual: 'Manual', inferred: 'Inferred', distribution: 'Delay reasons',
      tasks: 'tasks', noData: 'No delays detected', tableTitle: 'Reason breakdown', reasonCol: 'Reason',
      avgDwell: 'Avg stall', footnote: 'Manual tags take precedence over reasons auto-inferred from long stalls.',
      tagLabel: 'Delay reason', untagged: 'No delay reason',
      reason: {
        blocked_dependency: 'Blocked by dependency', awaiting_review: 'Awaiting review', scope_change: 'Scope change',
        unclear_requirements: 'Unclear requirements', external: 'External blocker', capacity: 'Capacity / queue', other: 'Other',
      },
    },
    release: { label: 'Release', none: 'No release' },
    pulse: {
      title: 'Team pulse', thanks: 'Thanks — your response was recorded.', submit: 'Submit',
      commentPlaceholder: 'Optional comment (anonymous)', latestAvg: 'Latest average', latestEnps: 'Latest eNPS',
      trend: 'Sentiment trend', responses: 'responses', create: 'New pulse', questionPlaceholder: 'Ask one question…',
      scale: 'Scale', open: 'Open', surveys: 'Surveys', noSurveys: 'No surveys yet', question: 'Question',
      average: 'Average', enps: 'eNPS', status: 'Status', active: 'Active', closed: 'Closed', close: 'Close',
    },
    export: {
      dataset: 'Dataset', csv: 'CSV', html: 'Printable',
      datasets: { dora: 'DORA', finance: 'Finance', allocation: 'Allocation', benchmarking: 'Benchmarking' },
    },
    recon: {
      fiscalYear: 'Fiscal year', variance: 'Variance', quartersTitle: 'Reported quarters', quarter: 'Quarter', revenue: 'Revenue',
      derivedBase: 'Derived R&D base', derivedSub: 'From effort + AI spend', reportedActual: 'Reported actual',
      reportedSub: 'Manual quarterly facts', derivedLabor: 'Derived labor', derivedAiSpend: 'Derived AI spend',
      reportedPlan: 'Reported plan', rdToRevenue: 'R&D / revenue',
      footnote: 'Derived is a QRE-style estimate; reported is manually entered — variance flags divergence.',
      flag: { aligned: 'Aligned', derived_higher: 'Derived higher', reported_higher: 'Reported higher', no_reported: 'No reported data' },
    },
  }, {
    panel: {
      crossTeam: 'Cross-team', crossTeamDesc: 'Rank each team against the others',
      delayTaxonomy: 'Delay causes', delayTaxonomyDesc: 'Why work is running late',
    },
  }),
  zh: build({
    loading: '加载中…',
    crossTeam: {
      noTeams: '暂无团队', noData: '无可比较团队', leaderboard: '团队排名',
      footnote: '百分位将每个团队与本租户的其他团队在该时间窗内比较。',
      tableTitle: '团队指标', team: '团队', members: '成员', overall: '综合',
      metric: { throughput: '吞吐量', avg_cycle_time_hours: '周期时间', rework_rate_pct: '返工', effectiveness: '有效性' },
    },
    delay: {
      taggedTasks: '已标记任务', manual: '手动', inferred: '推断', distribution: '延误原因',
      tasks: '个任务', noData: '未检测到延误', tableTitle: '原因明细', reasonCol: '原因',
      avgDwell: '平均停滞', footnote: '手动标记优先于由长时间停滞自动推断的原因。',
      tagLabel: '延误原因', untagged: '无延误原因',
      reason: {
        blocked_dependency: '被依赖阻塞', awaiting_review: '等待评审', scope_change: '范围变更',
        unclear_requirements: '需求不明确', external: '外部阻塞', capacity: '产能 / 排队', other: '其他',
      },
    },
    release: { label: '发布', none: '无发布' },
    pulse: {
      title: '团队脉搏', thanks: '谢谢 — 您的回复已记录。', submit: '提交',
      commentPlaceholder: '可选评论（匿名）', latestAvg: '最新平均', latestEnps: '最新 eNPS',
      trend: '情绪趋势', responses: '份回复', create: '新建脉搏', questionPlaceholder: '提出一个问题…',
      scale: '量级', open: '开启', surveys: '调查', noSurveys: '暂无调查', question: '问题',
      average: '平均', enps: 'eNPS', status: '状态', active: '进行中', closed: '已关闭', close: '关闭',
    },
    export: {
      dataset: '数据集', csv: 'CSV', html: '可打印',
      datasets: { dora: 'DORA', finance: '财务', allocation: '投入分配', benchmarking: '基准对比' },
    },
    recon: {
      fiscalYear: '财年', variance: '差异', quartersTitle: '已报告季度', quarter: '季度', revenue: '收入',
      derivedBase: '推导研发基数', derivedSub: '来自投入 + AI 支出', reportedActual: '报告实际',
      reportedSub: '手动季度数据', derivedLabor: '推导人工', derivedAiSpend: '推导 AI 支出',
      reportedPlan: '报告计划', rdToRevenue: '研发 / 收入',
      footnote: '推导为 QRE 式估算；报告为手动录入 — 差异用于标记背离。',
      flag: { aligned: '一致', derived_higher: '推导偏高', reported_higher: '报告偏高', no_reported: '无报告数据' },
    },
  }, {
    panel: {
      crossTeam: '跨团队', crossTeamDesc: '将每个团队与其他团队排名',
      delayTaxonomy: '延误原因', delayTaxonomyDesc: '工作为何延误',
    },
  }),
  es: build({
    loading: 'Cargando…',
    crossTeam: {
      noTeams: 'Aún no hay equipos', noData: 'Sin equipos comparables', leaderboard: 'Posición de equipos',
      footnote: 'Los percentiles clasifican cada equipo frente a los demás equipos del inquilino en el período.',
      tableTitle: 'Métricas por equipo', team: 'Equipo', members: 'Miembros', overall: 'Global',
      metric: { throughput: 'Rendimiento', avg_cycle_time_hours: 'Tiempo de ciclo', rework_rate_pct: 'Retrabajo', effectiveness: 'Efectividad' },
    },
    delay: {
      taggedTasks: 'Tareas etiquetadas', manual: 'Manual', inferred: 'Inferido', distribution: 'Causas de retraso',
      tasks: 'tareas', noData: 'Sin retrasos detectados', tableTitle: 'Desglose por causa', reasonCol: 'Causa',
      avgDwell: 'Estancamiento medio', footnote: 'Las etiquetas manuales tienen prioridad sobre las causas inferidas de estancamientos largos.',
      tagLabel: 'Causa del retraso', untagged: 'Sin causa de retraso',
      reason: {
        blocked_dependency: 'Bloqueado por dependencia', awaiting_review: 'En espera de revisión', scope_change: 'Cambio de alcance',
        unclear_requirements: 'Requisitos poco claros', external: 'Bloqueo externo', capacity: 'Capacidad / cola', other: 'Otro',
      },
    },
    release: { label: 'Versión', none: 'Sin versión' },
    pulse: {
      title: 'Pulso del equipo', thanks: 'Gracias — tu respuesta se registró.', submit: 'Enviar',
      commentPlaceholder: 'Comentario opcional (anónimo)', latestAvg: 'Promedio reciente', latestEnps: 'eNPS reciente',
      trend: 'Tendencia de sentimiento', responses: 'respuestas', create: 'Nuevo pulso', questionPlaceholder: 'Haz una pregunta…',
      scale: 'Escala', open: 'Abrir', surveys: 'Encuestas', noSurveys: 'Aún no hay encuestas', question: 'Pregunta',
      average: 'Promedio', enps: 'eNPS', status: 'Estado', active: 'Activa', closed: 'Cerrada', close: 'Cerrar',
    },
    export: {
      dataset: 'Conjunto', csv: 'CSV', html: 'Imprimible',
      datasets: { dora: 'DORA', finance: 'Finanzas', allocation: 'Asignación', benchmarking: 'Comparativa' },
    },
    recon: {
      fiscalYear: 'Año fiscal', variance: 'Variación', quartersTitle: 'Trimestres reportados', quarter: 'Trimestre', revenue: 'Ingresos',
      derivedBase: 'Base I+D derivada', derivedSub: 'De esfuerzo + gasto de IA', reportedActual: 'Real reportado',
      reportedSub: 'Datos trimestrales manuales', derivedLabor: 'Mano de obra derivada', derivedAiSpend: 'Gasto de IA derivado',
      reportedPlan: 'Plan reportado', rdToRevenue: 'I+D / ingresos',
      footnote: 'Lo derivado es una estimación tipo QRE; lo reportado se ingresa manualmente — la variación señala divergencias.',
      flag: { aligned: 'Alineado', derived_higher: 'Derivado mayor', reported_higher: 'Reportado mayor', no_reported: 'Sin datos reportados' },
    },
  }, {
    panel: {
      crossTeam: 'Entre equipos', crossTeamDesc: 'Clasifica cada equipo frente a los demás',
      delayTaxonomy: 'Causas de retraso', delayTaxonomyDesc: 'Por qué el trabajo va con retraso',
    },
  }),
  fr: build({
    loading: 'Chargement…',
    crossTeam: {
      noTeams: 'Aucune équipe', noData: 'Aucune équipe comparable', leaderboard: 'Classement des équipes',
      footnote: 'Les centiles classent chaque équipe par rapport aux autres équipes du locataire sur la période.',
      tableTitle: 'Indicateurs par équipe', team: 'Équipe', members: 'Membres', overall: 'Global',
      metric: { throughput: 'Débit', avg_cycle_time_hours: 'Temps de cycle', rework_rate_pct: 'Reprise', effectiveness: 'Efficacité' },
    },
    delay: {
      taggedTasks: 'Tâches étiquetées', manual: 'Manuel', inferred: 'Inféré', distribution: 'Causes de retard',
      tasks: 'tâches', noData: 'Aucun retard détecté', tableTitle: 'Répartition par cause', reasonCol: 'Cause',
      avgDwell: 'Blocage moyen', footnote: 'Les étiquettes manuelles priment sur les causes inférées des blocages longs.',
      tagLabel: 'Cause du retard', untagged: 'Aucune cause de retard',
      reason: {
        blocked_dependency: 'Bloqué par une dépendance', awaiting_review: 'En attente de revue', scope_change: 'Changement de périmètre',
        unclear_requirements: 'Exigences floues', external: 'Blocage externe', capacity: 'Capacité / file', other: 'Autre',
      },
    },
    release: { label: 'Version', none: 'Aucune version' },
    pulse: {
      title: 'Pouls d’équipe', thanks: 'Merci — votre réponse a été enregistrée.', submit: 'Envoyer',
      commentPlaceholder: 'Commentaire facultatif (anonyme)', latestAvg: 'Moyenne récente', latestEnps: 'eNPS récent',
      trend: 'Tendance du ressenti', responses: 'réponses', create: 'Nouveau pouls', questionPlaceholder: 'Posez une question…',
      scale: 'Échelle', open: 'Ouvrir', surveys: 'Enquêtes', noSurveys: 'Aucune enquête', question: 'Question',
      average: 'Moyenne', enps: 'eNPS', status: 'Statut', active: 'Active', closed: 'Fermée', close: 'Fermer',
    },
    export: {
      dataset: 'Jeu de données', csv: 'CSV', html: 'Imprimable',
      datasets: { dora: 'DORA', finance: 'Finance', allocation: 'Allocation', benchmarking: 'Comparatif' },
    },
    recon: {
      fiscalYear: 'Exercice', variance: 'Écart', quartersTitle: 'Trimestres déclarés', quarter: 'Trimestre', revenue: 'Revenu',
      derivedBase: 'Base R&D dérivée', derivedSub: 'À partir de l’effort + dépense IA', reportedActual: 'Réel déclaré',
      reportedSub: 'Données trimestrielles manuelles', derivedLabor: 'Main-d’œuvre dérivée', derivedAiSpend: 'Dépense IA dérivée',
      reportedPlan: 'Plan déclaré', rdToRevenue: 'R&D / revenu',
      footnote: 'Le dérivé est une estimation type QRE ; le déclaré est saisi manuellement — l’écart signale la divergence.',
      flag: { aligned: 'Aligné', derived_higher: 'Dérivé supérieur', reported_higher: 'Déclaré supérieur', no_reported: 'Aucune donnée déclarée' },
    },
  }, {
    panel: {
      crossTeam: 'Inter-équipes', crossTeamDesc: 'Classer chaque équipe par rapport aux autres',
      delayTaxonomy: 'Causes de retard', delayTaxonomyDesc: 'Pourquoi le travail est en retard',
    },
  }),
  de: build({
    loading: 'Wird geladen…',
    crossTeam: {
      noTeams: 'Noch keine Teams', noData: 'Keine vergleichbaren Teams', leaderboard: 'Team-Rangliste',
      footnote: 'Perzentile ordnen jedes Team gegenüber den anderen Teams des Mandanten im Zeitraum ein.',
      tableTitle: 'Team-Kennzahlen', team: 'Team', members: 'Mitglieder', overall: 'Gesamt',
      metric: { throughput: 'Durchsatz', avg_cycle_time_hours: 'Durchlaufzeit', rework_rate_pct: 'Nacharbeit', effectiveness: 'Effektivität' },
    },
    delay: {
      taggedTasks: 'Markierte Aufgaben', manual: 'Manuell', inferred: 'Abgeleitet', distribution: 'Verzögerungsgründe',
      tasks: 'Aufgaben', noData: 'Keine Verzögerungen erkannt', tableTitle: 'Aufschlüsselung nach Grund', reasonCol: 'Grund',
      avgDwell: 'Ø Stillstand', footnote: 'Manuelle Markierungen haben Vorrang vor aus langen Stillständen abgeleiteten Gründen.',
      tagLabel: 'Verzögerungsgrund', untagged: 'Kein Verzögerungsgrund',
      reason: {
        blocked_dependency: 'Durch Abhängigkeit blockiert', awaiting_review: 'Wartet auf Review', scope_change: 'Umfangsänderung',
        unclear_requirements: 'Unklare Anforderungen', external: 'Externe Blockade', capacity: 'Kapazität / Warteschlange', other: 'Sonstiges',
      },
    },
    release: { label: 'Release', none: 'Kein Release' },
    pulse: {
      title: 'Team-Puls', thanks: 'Danke — Ihre Antwort wurde erfasst.', submit: 'Senden',
      commentPlaceholder: 'Optionaler Kommentar (anonym)', latestAvg: 'Letzter Durchschnitt', latestEnps: 'Letzter eNPS',
      trend: 'Stimmungstrend', responses: 'Antworten', create: 'Neuer Puls', questionPlaceholder: 'Eine Frage stellen…',
      scale: 'Skala', open: 'Öffnen', surveys: 'Umfragen', noSurveys: 'Noch keine Umfragen', question: 'Frage',
      average: 'Durchschnitt', enps: 'eNPS', status: 'Status', active: 'Aktiv', closed: 'Geschlossen', close: 'Schließen',
    },
    export: {
      dataset: 'Datensatz', csv: 'CSV', html: 'Druckbar',
      datasets: { dora: 'DORA', finance: 'Finanzen', allocation: 'Zuordnung', benchmarking: 'Benchmarking' },
    },
    recon: {
      fiscalYear: 'Geschäftsjahr', variance: 'Abweichung', quartersTitle: 'Gemeldete Quartale', quarter: 'Quartal', revenue: 'Umsatz',
      derivedBase: 'Abgeleitete F&E-Basis', derivedSub: 'Aus Aufwand + KI-Kosten', reportedActual: 'Gemeldeter Ist-Wert',
      reportedSub: 'Manuelle Quartalsdaten', derivedLabor: 'Abgeleitete Arbeit', derivedAiSpend: 'Abgeleitete KI-Kosten',
      reportedPlan: 'Gemeldeter Plan', rdToRevenue: 'F&E / Umsatz',
      footnote: 'Abgeleitet ist eine QRE-artige Schätzung; gemeldet wird manuell erfasst — die Abweichung markiert Divergenz.',
      flag: { aligned: 'Übereinstimmend', derived_higher: 'Abgeleitet höher', reported_higher: 'Gemeldet höher', no_reported: 'Keine gemeldeten Daten' },
    },
  }, {
    panel: {
      crossTeam: 'Team-übergreifend', crossTeamDesc: 'Jedes Team gegen die anderen einordnen',
      delayTaxonomy: 'Verzögerungsgründe', delayTaxonomyDesc: 'Warum die Arbeit im Verzug ist',
    },
  }),
};
