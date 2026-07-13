// i18n patch: superadmin Health/Usage historical trends.
const h = (o) => ({ admin: { health: o } });

export const PATCHES = {
  en: h({ trends: 'Platform trends', windowDays: '{days}d', newUsers: 'New users', newWorkspaces: 'New workspaces', llmTokens: 'LLM tokens', llmSpend: 'LLM spend', errorVolume: 'Error volume' }),
  zh: h({ trends: '平台趋势', windowDays: '{days} 天', newUsers: '新用户', newWorkspaces: '新工作区', llmTokens: 'LLM 令牌', llmSpend: 'LLM 支出', errorVolume: '错误量' }),
  es: h({ trends: 'Tendencias de la plataforma', windowDays: '{days} d', newUsers: 'Nuevos usuarios', newWorkspaces: 'Nuevos espacios', llmTokens: 'Tokens LLM', llmSpend: 'Gasto LLM', errorVolume: 'Volumen de errores' }),
  fr: h({ trends: 'Tendances de la plateforme', windowDays: '{days} j', newUsers: 'Nouveaux utilisateurs', newWorkspaces: 'Nouveaux espaces', llmTokens: 'Jetons LLM', llmSpend: 'Dépenses LLM', errorVolume: "Volume d'erreurs" }),
  de: h({ trends: 'Plattform-Trends', windowDays: '{days} T', newUsers: 'Neue Nutzer', newWorkspaces: 'Neue Workspaces', llmTokens: 'LLM-Tokens', llmSpend: 'LLM-Ausgaben', errorVolume: 'Fehlervolumen' }),
};
