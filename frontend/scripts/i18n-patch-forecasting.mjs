// i18n patch: forecasting / anomaly lens + PMO scope pickers + upgrade CTA.
// Deep-merges under the `insights` namespace (forecast.*, fin.scope*, funnel.link*,
// upgrade.*) and the `widgets` namespace (group.forecast + title.forecast*).
// Run: node scripts/i18n-merge.mjs scripts/i18n-patch-forecasting.mjs
const build = (forecast, finScope, funnelLink, upgrade, wGroup, wTitle) => ({
  insights: {
    forecast,
    fin: finScope,
    funnel: funnelLink,
    upgrade,
  },
  widgets: { group: { forecast: wGroup }, title: wTitle },
});

export const PATCHES = {
  en: build(
    {
      title: 'Forecast & anomalies', subtitle: 'Where each metric is heading, and what already looks off.',
      error: 'Could not load the forecast.', noData: 'Not enough history to forecast yet.',
      metricLabel: 'Metric', history: 'History', projected: 'Projected', projection: 'Projected',
      trend: 'Trend', trendUp: 'Rising', trendDown: 'Falling', trendFlat: 'Flat',
      rSquared: 'Fit R² {r}%', anomalies: 'Anomalies', anomaliesSub: 'Points beyond 2σ', dismiss: 'Dismiss',
      chartAria: '{metric} history and projection',
      metric: { cost: 'Spend', cycle_time: 'Cycle time', cfr: 'Change-failure rate', throughput: 'Deploy throughput' },
    },
    { scope: 'Scope', scopeWorkspace: 'Whole workspace', scopeProjects: 'Projects', scopeInitiatives: 'Initiatives' },
    { link: 'Link to', linkNone: 'No link', linkProjects: 'Projects', linkInitiatives: 'Initiatives' },
    { title: 'This lens needs a higher plan', body: "Advanced insights aren't included in your {plan} plan. Upgrade to unlock forecasting, anomaly detection and the exec lenses.", cta: 'View plans' },
    'Forecast',
    { forecastCostProjection: 'Projected spend', forecastCycleProjection: 'Projected cycle time', forecastCfrProjection: 'Projected change-failure', forecastAnomalies: 'Open anomalies', forecastCostTrend: 'Spend forecast' },
  ),
  zh: build(
    {
      title: '预测与异常', subtitle: '每项指标的走向，以及哪里已经出现异常。',
      error: '无法加载预测。', noData: '历史数据不足，暂无法预测。',
      metricLabel: '指标', history: '历史', projected: '预测', projection: '预测值',
      trend: '趋势', trendUp: '上升', trendDown: '下降', trendFlat: '持平',
      rSquared: '拟合度 R² {r}%', anomalies: '异常', anomaliesSub: '超过 2σ 的点', dismiss: '忽略',
      chartAria: '{metric} 历史与预测',
      metric: { cost: '花费', cycle_time: '周期时间', cfr: '变更失败率', throughput: '部署吞吐量' },
    },
    { scope: '范围', scopeWorkspace: '整个工作区', scopeProjects: '项目', scopeInitiatives: '举措' },
    { link: '关联到', linkNone: '不关联', linkProjects: '项目', linkInitiatives: '举措' },
    { title: '此视图需要更高的套餐', body: '高级洞察不包含在您的 {plan} 套餐中。升级即可解锁预测、异常检测和高管视图。', cta: '查看套餐' },
    '预测',
    { forecastCostProjection: '预测花费', forecastCycleProjection: '预测周期时间', forecastCfrProjection: '预测变更失败', forecastAnomalies: '未处理异常', forecastCostTrend: '花费预测' },
  ),
  es: build(
    {
      title: 'Pronóstico y anomalías', subtitle: 'Hacia dónde va cada métrica y qué ya parece anómalo.',
      error: 'No se pudo cargar el pronóstico.', noData: 'Historial insuficiente para pronosticar.',
      metricLabel: 'Métrica', history: 'Histórico', projected: 'Proyectado', projection: 'Proyección',
      trend: 'Tendencia', trendUp: 'Al alza', trendDown: 'A la baja', trendFlat: 'Estable',
      rSquared: 'Ajuste R² {r}%', anomalies: 'Anomalías', anomaliesSub: 'Puntos más allá de 2σ', dismiss: 'Descartar',
      chartAria: 'Histórico y proyección de {metric}',
      metric: { cost: 'Gasto', cycle_time: 'Tiempo de ciclo', cfr: 'Tasa de fallo de cambios', throughput: 'Rendimiento de despliegues' },
    },
    { scope: 'Alcance', scopeWorkspace: 'Todo el espacio', scopeProjects: 'Proyectos', scopeInitiatives: 'Iniciativas' },
    { link: 'Vincular a', linkNone: 'Sin vínculo', linkProjects: 'Proyectos', linkInitiatives: 'Iniciativas' },
    { title: 'Esta vista requiere un plan superior', body: 'Los insights avanzados no se incluyen en tu plan {plan}. Mejora para desbloquear pronósticos, detección de anomalías y las vistas ejecutivas.', cta: 'Ver planes' },
    'Pronóstico',
    { forecastCostProjection: 'Gasto proyectado', forecastCycleProjection: 'Tiempo de ciclo proyectado', forecastCfrProjection: 'Fallo de cambios proyectado', forecastAnomalies: 'Anomalías abiertas', forecastCostTrend: 'Pronóstico de gasto' },
  ),
  fr: build(
    {
      title: 'Prévisions et anomalies', subtitle: 'Où va chaque métrique, et ce qui semble déjà anormal.',
      error: 'Impossible de charger la prévision.', noData: 'Historique insuffisant pour prévoir.',
      metricLabel: 'Métrique', history: 'Historique', projected: 'Projeté', projection: 'Projection',
      trend: 'Tendance', trendUp: 'En hausse', trendDown: 'En baisse', trendFlat: 'Stable',
      rSquared: 'Ajustement R² {r}%', anomalies: 'Anomalies', anomaliesSub: 'Points au-delà de 2σ', dismiss: 'Ignorer',
      chartAria: 'Historique et projection de {metric}',
      metric: { cost: 'Dépense', cycle_time: 'Temps de cycle', cfr: 'Taux d\'échec des changements', throughput: 'Débit de déploiement' },
    },
    { scope: 'Portée', scopeWorkspace: 'Tout l\'espace', scopeProjects: 'Projets', scopeInitiatives: 'Initiatives' },
    { link: 'Lier à', linkNone: 'Aucun lien', linkProjects: 'Projets', linkInitiatives: 'Initiatives' },
    { title: 'Cette vue nécessite un forfait supérieur', body: "Les analyses avancées ne sont pas incluses dans votre forfait {plan}. Passez à un forfait supérieur pour débloquer les prévisions, la détection d'anomalies et les vues de direction.", cta: 'Voir les forfaits' },
    'Prévisions',
    { forecastCostProjection: 'Dépense projetée', forecastCycleProjection: 'Temps de cycle projeté', forecastCfrProjection: 'Échec de changements projeté', forecastAnomalies: 'Anomalies ouvertes', forecastCostTrend: 'Prévision de dépense' },
  ),
  de: build(
    {
      title: 'Prognose & Anomalien', subtitle: 'Wohin sich jede Kennzahl entwickelt und was bereits auffällt.',
      error: 'Prognose konnte nicht geladen werden.', noData: 'Noch nicht genug Verlauf für eine Prognose.',
      metricLabel: 'Kennzahl', history: 'Verlauf', projected: 'Prognostiziert', projection: 'Prognose',
      trend: 'Trend', trendUp: 'Steigend', trendDown: 'Fallend', trendFlat: 'Konstant',
      rSquared: 'Anpassung R² {r}%', anomalies: 'Anomalien', anomaliesSub: 'Punkte über 2σ', dismiss: 'Verwerfen',
      chartAria: '{metric}: Verlauf und Prognose',
      metric: { cost: 'Ausgaben', cycle_time: 'Durchlaufzeit', cfr: 'Änderungsfehlerrate', throughput: 'Deploy-Durchsatz' },
    },
    { scope: 'Bereich', scopeWorkspace: 'Gesamter Workspace', scopeProjects: 'Projekte', scopeInitiatives: 'Initiativen' },
    { link: 'Verknüpfen mit', linkNone: 'Keine Verknüpfung', linkProjects: 'Projekte', linkInitiatives: 'Initiativen' },
    { title: 'Diese Ansicht erfordert einen höheren Tarif', body: 'Erweiterte Insights sind in Ihrem {plan}-Tarif nicht enthalten. Upgraden Sie, um Prognosen, Anomalieerkennung und die Führungsansichten freizuschalten.', cta: 'Tarife ansehen' },
    'Prognose',
    { forecastCostProjection: 'Prognostizierte Ausgaben', forecastCycleProjection: 'Prognostizierte Durchlaufzeit', forecastCfrProjection: 'Prognostizierte Änderungsfehler', forecastAnomalies: 'Offene Anomalien', forecastCostTrend: 'Ausgabenprognose' },
  ),
};
