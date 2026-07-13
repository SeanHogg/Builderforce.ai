// i18n patch: extended member / EMP metrics (Allocation / Collaboration /
// Documentation / Labor cost / Performers / Initiative allocation).
// Adds widget group+title labels and the `emp.*` panel strings under `widgets`.
const build = (g, t, e) => ({ widgets: { group: g, title: t, emp: e } });

export const PATCHES = {
  en: build(
    {
      empAllocation: 'Allocation', empCollaboration: 'Collaboration', empDocs: 'Documentation',
      empCost: 'Labor cost', empPerformers: 'Performers', empInitiatives: 'Initiative mix',
    },
    {
      empOverAllocated: 'Over-allocated members', empCollabScore: 'Collaboration score',
      empDocAuthors: 'Top doc contributors', empLaborByProject: 'Labor cost by project',
      empPerformerTiers: 'Performer tiers', empInitiativeMix: 'Initiative allocation',
    },
    {
      teamAnalytics: 'Team analytics', allocationTitle: 'Over-allocation',
      allocationSub: 'Observed WIP vs. each member’s ceiling', collaborationTitle: 'Collaboration',
      docTitle: 'Documentation activity', costTitle: 'Labor cost', performersTitle: 'Performers & coaching',
      initiativesTitle: 'Initiative allocation',
      member: 'Member', overAllocated: 'Over-allocated', withinCapacity: 'Within capacity',
      wip: 'WIP', max: 'Max', utilization: 'Utilization',
      reviews: 'Reviews', comments: 'Comments', handoffs: 'Handoffs', turnaround: 'Turnaround', score: 'Score',
      authored: 'Authored', edits: 'Edits', acks: 'Acks',
      cost: 'Cost', effortH: 'Effort (h)', tasks: 'Tasks', project: 'Project', initiative: 'Initiative', totalCost: 'Total cost',
      tier: 'Tier', tierHigh: 'High', tierSolid: 'Solid', tierWatch: 'Watch', percentile: 'Percentile', composite: 'Composite',
      addNote: 'Add coaching note', notePlaceholder: 'Coaching note…', saveNote: 'Save', noNotes: 'No coaching notes yet', deleteNote: 'Delete',
      noData: 'No data in this window', loading: 'Loading…', exportCsv: 'Export CSV', exporting: 'Exporting…', focusMix: 'Focus',
    },
  ),
  zh: build(
    {
      empAllocation: '工作分配', empCollaboration: '协作', empDocs: '文档',
      empCost: '人力成本', empPerformers: '绩效', empInitiatives: '战略分布',
    },
    {
      empOverAllocated: '超额分配成员', empCollabScore: '协作评分',
      empDocAuthors: '文档贡献榜', empLaborByProject: '按项目的人力成本',
      empPerformerTiers: '绩效分层', empInitiativeMix: '战略分配',
    },
    {
      teamAnalytics: '团队分析', allocationTitle: '超额分配',
      allocationSub: '实际 WIP 与成员上限对比', collaborationTitle: '协作',
      docTitle: '文档活动', costTitle: '人力成本', performersTitle: '绩效与辅导',
      initiativesTitle: '战略分配',
      member: '成员', overAllocated: '超额分配', withinCapacity: '容量内',
      wip: 'WIP', max: '上限', utilization: '利用率',
      reviews: '评审', comments: '评论', handoffs: '交接', turnaround: '周转', score: '评分',
      authored: '创建', edits: '编辑', acks: '确认',
      cost: '成本', effortH: '工时（小时）', tasks: '任务', project: '项目', initiative: '战略', totalCost: '总成本',
      tier: '层级', tierHigh: '高', tierSolid: '稳定', tierWatch: '关注', percentile: '百分位', composite: '综合',
      addNote: '添加辅导笔记', notePlaceholder: '辅导笔记…', saveNote: '保存', noNotes: '暂无辅导笔记', deleteNote: '删除',
      noData: '此时间段暂无数据', loading: '加载中…', exportCsv: '导出 CSV', exporting: '导出中…', focusMix: '专注度',
    },
  ),
  es: build(
    {
      empAllocation: 'Asignación', empCollaboration: 'Colaboración', empDocs: 'Documentación',
      empCost: 'Costo laboral', empPerformers: 'Desempeño', empInitiatives: 'Mezcla de iniciativas',
    },
    {
      empOverAllocated: 'Miembros sobreasignados', empCollabScore: 'Puntuación de colaboración',
      empDocAuthors: 'Principales autores de docs', empLaborByProject: 'Costo laboral por proyecto',
      empPerformerTiers: 'Niveles de desempeño', empInitiativeMix: 'Asignación por iniciativa',
    },
    {
      teamAnalytics: 'Analítica del equipo', allocationTitle: 'Sobreasignación',
      allocationSub: 'WIP observado vs. el límite de cada miembro', collaborationTitle: 'Colaboración',
      docTitle: 'Actividad de documentación', costTitle: 'Costo laboral', performersTitle: 'Desempeño y coaching',
      initiativesTitle: 'Asignación por iniciativa',
      member: 'Miembro', overAllocated: 'Sobreasignado', withinCapacity: 'Dentro de capacidad',
      wip: 'WIP', max: 'Máx', utilization: 'Utilización',
      reviews: 'Revisiones', comments: 'Comentarios', handoffs: 'Traspasos', turnaround: 'Tiempo de respuesta', score: 'Puntuación',
      authored: 'Creados', edits: 'Ediciones', acks: 'Confirmaciones',
      cost: 'Costo', effortH: 'Esfuerzo (h)', tasks: 'Tareas', project: 'Proyecto', initiative: 'Iniciativa', totalCost: 'Costo total',
      tier: 'Nivel', tierHigh: 'Alto', tierSolid: 'Sólido', tierWatch: 'Vigilar', percentile: 'Percentil', composite: 'Compuesto',
      addNote: 'Añadir nota de coaching', notePlaceholder: 'Nota de coaching…', saveNote: 'Guardar', noNotes: 'Aún no hay notas de coaching', deleteNote: 'Eliminar',
      noData: 'Sin datos en esta ventana', loading: 'Cargando…', exportCsv: 'Exportar CSV', exporting: 'Exportando…', focusMix: 'Enfoque',
    },
  ),
  fr: build(
    {
      empAllocation: 'Répartition', empCollaboration: 'Collaboration', empDocs: 'Documentation',
      empCost: 'Coût de main-d’œuvre', empPerformers: 'Performance', empInitiatives: 'Répartition par initiative',
    },
    {
      empOverAllocated: 'Membres surchargés', empCollabScore: 'Score de collaboration',
      empDocAuthors: 'Principaux contributeurs docs', empLaborByProject: 'Coût par projet',
      empPerformerTiers: 'Niveaux de performance', empInitiativeMix: 'Répartition par initiative',
    },
    {
      teamAnalytics: 'Analyse d’équipe', allocationTitle: 'Surcharge',
      allocationSub: 'WIP observé vs. le plafond de chaque membre', collaborationTitle: 'Collaboration',
      docTitle: 'Activité de documentation', costTitle: 'Coût de main-d’œuvre', performersTitle: 'Performance et coaching',
      initiativesTitle: 'Répartition par initiative',
      member: 'Membre', overAllocated: 'Surchargé', withinCapacity: 'Dans la capacité',
      wip: 'WIP', max: 'Max', utilization: 'Utilisation',
      reviews: 'Revues', comments: 'Commentaires', handoffs: 'Transferts', turnaround: 'Délai', score: 'Score',
      authored: 'Créés', edits: 'Éditions', acks: 'Accusés',
      cost: 'Coût', effortH: 'Effort (h)', tasks: 'Tâches', project: 'Projet', initiative: 'Initiative', totalCost: 'Coût total',
      tier: 'Niveau', tierHigh: 'Élevé', tierSolid: 'Solide', tierWatch: 'À surveiller', percentile: 'Percentile', composite: 'Composite',
      addNote: 'Ajouter une note de coaching', notePlaceholder: 'Note de coaching…', saveNote: 'Enregistrer', noNotes: 'Aucune note de coaching', deleteNote: 'Supprimer',
      noData: 'Aucune donnée sur cette période', loading: 'Chargement…', exportCsv: 'Exporter CSV', exporting: 'Exportation…', focusMix: 'Focalisation',
    },
  ),
  de: build(
    {
      empAllocation: 'Zuteilung', empCollaboration: 'Zusammenarbeit', empDocs: 'Dokumentation',
      empCost: 'Arbeitskosten', empPerformers: 'Leistung', empInitiatives: 'Initiativen-Mix',
    },
    {
      empOverAllocated: 'Überlastete Mitglieder', empCollabScore: 'Kollaborations-Score',
      empDocAuthors: 'Top-Dok-Beitragende', empLaborByProject: 'Arbeitskosten nach Projekt',
      empPerformerTiers: 'Leistungsstufen', empInitiativeMix: 'Initiativen-Zuteilung',
    },
    {
      teamAnalytics: 'Team-Analyse', allocationTitle: 'Überlastung',
      allocationSub: 'Beobachtete WIP vs. Obergrenze je Mitglied', collaborationTitle: 'Zusammenarbeit',
      docTitle: 'Dokumentations-Aktivität', costTitle: 'Arbeitskosten', performersTitle: 'Leistung & Coaching',
      initiativesTitle: 'Initiativen-Zuteilung',
      member: 'Mitglied', overAllocated: 'Überlastet', withinCapacity: 'Innerhalb der Kapazität',
      wip: 'WIP', max: 'Max', utilization: 'Auslastung',
      reviews: 'Reviews', comments: 'Kommentare', handoffs: 'Übergaben', turnaround: 'Durchlaufzeit', score: 'Score',
      authored: 'Erstellt', edits: 'Bearbeitungen', acks: 'Bestätigungen',
      cost: 'Kosten', effortH: 'Aufwand (Std.)', tasks: 'Aufgaben', project: 'Projekt', initiative: 'Initiative', totalCost: 'Gesamtkosten',
      tier: 'Stufe', tierHigh: 'Hoch', tierSolid: 'Solide', tierWatch: 'Beobachten', percentile: 'Perzentil', composite: 'Gesamt',
      addNote: 'Coaching-Notiz hinzufügen', notePlaceholder: 'Coaching-Notiz…', saveNote: 'Speichern', noNotes: 'Noch keine Coaching-Notizen', deleteNote: 'Löschen',
      noData: 'Keine Daten in diesem Zeitraum', loading: 'Wird geladen…', exportCsv: 'CSV exportieren', exporting: 'Exportiere…', focusMix: 'Fokus',
    },
  ),
};
