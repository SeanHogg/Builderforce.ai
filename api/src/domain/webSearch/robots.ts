export interface RobotsDecision { allowed: boolean; crawlDelayMs: number | null }

interface Group { agents: string[]; rules: Array<{ allow: boolean; path: string }>; delay: number | null }

/** RFC-9309-oriented parser: the most specific matching path wins; Allow wins ties. */
export function evaluateRobots(body: string, url: string, agent = 'BuilderforceSearchBot'): RobotsDecision {
  const groups: Group[] = [];
  let current: Group | null = null;
  let sawRule = false;
  for (const source of body.split(/\r?\n/)) {
    const line = source.replace(/\s*#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || sawRule) { current = { agents: [], rules: [], delay: null }; groups.push(current); sawRule = false; }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      sawRule = true;
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (current && key === 'crawl-delay') {
      sawRule = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.delay = Math.ceil(seconds * 1000);
    }
  }
  const needle = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => needle.includes(a) && a !== '*'));
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const path = `${new URL(url).pathname}${new URL(url).search}`;
  const rules = selected.flatMap((g) => g.rules).filter((r) => path.startsWith(r.path.replace(/\*.*$/, '')));
  rules.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  const delays = selected.map((g) => g.delay).filter((v): v is number => v !== null);
  return { allowed: rules[0]?.allow ?? true, crawlDelayMs: delays.length ? Math.max(...delays) : null };
}

