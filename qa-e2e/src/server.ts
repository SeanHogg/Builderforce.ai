/**
 * Agentic Tester container server — the long-lived process behind the
 * QaRunnerContainerDO (the platform's managed drain). Mirrors the agent
 * container contract (api/container/server.mjs): the DO starts this image and
 * proxies `POST /run` to it.
 *
 *   GET  /health  → 200 (DO liveness probe)
 *   POST /run     → { explorationId, agentToken, apiBaseUrl }
 *                   acks 202, then drives one exploration to completion. Findings
 *                   + outcome are posted back to the API by runExploration, so no
 *                   callback channel is needed here.
 *
 * The only secret it holds is the short-lived, tenant-scoped BF_AGENT_TOKEN the
 * Worker mints per run — no DB credentials, no human login.
 */

import { createServer } from 'node:http';
import { runExploration } from './runExploration';

const PORT = Number(process.env.PORT || 8080);

interface RunSpec {
  explorationId?: string;
  agentToken?: string;
  apiBaseUrl?: string;
  projectId?: number;
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/run') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let spec: RunSpec;
      try { spec = JSON.parse(raw) as RunSpec; } catch { res.writeHead(400); res.end('bad request'); return; }
      if (!spec.explorationId || !spec.agentToken) {
        res.writeHead(400); res.end('missing run spec fields (explorationId, agentToken)'); return;
      }
      // Inject the run's auth + scope into the env runExploration reads.
      process.env.BF_AGENT_TOKEN = spec.agentToken;
      process.env.BF_EXPLORATION_ID = spec.explorationId;
      if (spec.apiBaseUrl) process.env.BF_API_URL = spec.apiBaseUrl;
      if (spec.projectId != null) process.env.BF_PROJECT_ID = String(spec.projectId);

      // Ack immediately; the run is long and self-reports to the API, so the
      // Worker's dispatch fetch isn't held open for the whole exploration.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: spec.explorationId }));
      runExploration().catch((e) => console.error('[agentic-tester] run crashed', e));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`[agentic-tester] container server listening on :${PORT}`));
