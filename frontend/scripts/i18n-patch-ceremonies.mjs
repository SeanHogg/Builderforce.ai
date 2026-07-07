// i18n patch: ceremonies rollup widgets.
const build = (grp, t, o) => ({ widgets: { group: { ceremonies: grp }, title: t, obs: o } });

export const PATCHES = {
  en: build('Ceremonies',
    { obsCeremonyCadence: 'Ceremony cadence', obsCeremonyBalance: 'Ceremony talk balance' },
    { noCeremonies: 'No ceremonies yet', ceremoniesPerDay: 'Sessions / day', humanTalk: 'Human', agentTalk: 'AI agent', completed: 'completed' }),
  zh: build('仪式',
    { obsCeremonyCadence: '仪式节奏', obsCeremonyBalance: '仪式发言分布' },
    { noCeremonies: '暂无仪式', ceremoniesPerDay: '会话 / 天', humanTalk: '人类', agentTalk: 'AI 代理', completed: '已完成' }),
  es: build('Ceremonias',
    { obsCeremonyCadence: 'Cadencia de ceremonias', obsCeremonyBalance: 'Balance de intervención' },
    { noCeremonies: 'Sin ceremonias aún', ceremoniesPerDay: 'Sesiones / día', humanTalk: 'Humano', agentTalk: 'Agente IA', completed: 'completadas' }),
  fr: build('Cérémonies',
    { obsCeremonyCadence: 'Cadence des cérémonies', obsCeremonyBalance: 'Répartition de la parole' },
    { noCeremonies: 'Aucune cérémonie', ceremoniesPerDay: 'Sessions / jour', humanTalk: 'Humain', agentTalk: 'Agent IA', completed: 'terminées' }),
  de: build('Zeremonien',
    { obsCeremonyCadence: 'Zeremonien-Takt', obsCeremonyBalance: 'Redeanteil-Verteilung' },
    { noCeremonies: 'Noch keine Zeremonien', ceremoniesPerDay: 'Sitzungen / Tag', humanTalk: 'Mensch', agentTalk: 'KI-Agent', completed: 'abgeschlossen' }),
};
