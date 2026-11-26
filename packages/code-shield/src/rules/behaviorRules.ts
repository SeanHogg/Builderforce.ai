import type { Rule } from './rule.js';

/** Ports a WebSocket may use without looking suspicious. */
const STANDARD_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443, 3000]);

const NETWORK_SEND = /\bfetch\b|\bpost\b|http\.request/i;

/**
 * Malicious-behaviour heuristics. A single hit proves nothing (file reads, env access and sockets are
 * all legitimate): the scorer correlates categories, and the first six rules keep the ids the skill
 * installer has always reported.
 *
 * Those six are co-occurrence heuristics that bundled framework code trips routinely (next's server and
 * vitest's CLI read files, read `process.env` and send requests in one file), so their weights stay low
 * and `env-harvesting` counts as `exfiltration` (it only fires beside a network send): together they top
 * out at `log`, and only a stronger signal (a credential file, an exfil endpoint, a reverse shell) can
 * push a file to quarantine. `potential-exfiltration` + `env-harvesting` must not also earn the
 * credential-access + exfiltration correlation, since they are one observation, not two.
 */
export const BEHAVIOR_RULES: readonly Rule[] = [
  {
    id: 'behavior.dangerous-exec', category: 'insecure-code', severity: 'CRITICAL', weight: 10, attack: 'T1059', scope: 'line',
    title: 'Shell command execution detected (child_process)',
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
    remediation: 'Avoid spawning shells; if a process is required, pass a fixed argument array.',
  },
  {
    id: 'behavior.dynamic-code-execution', category: 'insecure-code', severity: 'CRITICAL', weight: 10, attack: 'T1059.007', scope: 'line',
    title: 'Dynamic code execution detected',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    remediation: 'Replace dynamic evaluation with a parser or a lookup table.',
  },
  {
    id: 'behavior.crypto-mining', category: 'cryptojacking', severity: 'CRITICAL', weight: 40, attack: 'T1496', scope: 'line',
    title: 'Possible crypto-mining reference detected',
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
    remediation: 'Remove the mining code; it uses the host\'s CPU without consent.',
  },
  {
    id: 'suspicious-network', category: 'exfiltration', severity: 'MEDIUM', weight: 10, attack: 'T1571', scope: 'line',
    title: 'WebSocket connection to non-standard port',
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
    accept: (m) => !STANDARD_PORTS.has(parseInt(m[1]!, 10)),
    remediation: 'Connect over a standard port to a known host.',
  },
  {
    id: 'potential-exfiltration', category: 'exfiltration', severity: 'MEDIUM', weight: 5, attack: 'T1041', scope: 'source',
    title: 'File read combined with network send — possible data exfiltration',
    pattern: /readFileSync|readFile/,
    requiresContext: NETWORK_SEND,
    remediation: 'Confirm the file contents sent over the network are intended.',
  },
  {
    id: 'env-harvesting', category: 'exfiltration', severity: 'CRITICAL', weight: 10, attack: 'T1552.001', scope: 'source',
    title: 'Environment variable access combined with network send — possible credential harvesting',
    pattern: /process\.env/,
    requiresContext: NETWORK_SEND,
    remediation: 'Do not send environment variables to a remote host; pass explicit, named values.',
  },
  {
    id: 'behavior.reverse-shell', category: 'remote-shell', severity: 'CRITICAL', weight: 45, attack: 'T1059', scope: 'line',
    title: 'Reverse-shell pattern',
    pattern: /\/bin\/(?:ba)?sh\s+-i\b|\bnc\s[^\n]{0,80}\s-e\b|\/dev\/tcp\//,
    remediation: 'Remove the remote-command channel.',
  },
  {
    id: 'behavior.credential-file', category: 'credential-access', severity: 'HIGH', weight: 25, attack: 'T1552.001', scope: 'line',
    title: 'Reads a credential file (ssh key, cloud credentials, npm / git token)',
    pattern: /\.ssh\/id_[a-z0-9]+|\.aws\/credentials|\.npmrc\b|\.git-credentials/,
    remediation: 'Do not read credential files from code; use the platform secret store.',
  },
  {
    id: 'behavior.persistence', category: 'persistence', severity: 'HIGH', weight: 25, attack: 'T1546', scope: 'line',
    title: 'Writes a shell startup file, git hook or crontab',
    pattern: /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream)\s*\([^\n]{0,120}(?:\.bashrc|\.zshrc|\.profile|\.git\/hooks\/)|\bcrontab\s+-/,
    remediation: 'Do not install startup hooks from package or generated code.',
  },
  {
    id: 'behavior.keylogger', category: 'keylogging', severity: 'HIGH', weight: 30, attack: 'T1056.001', scope: 'source',
    title: 'Keyboard capture combined with network send',
    pattern: /addEventListener\s*\(\s*['"]key(?:down|up|press)['"]/,
    requiresContext: /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket/,
    remediation: 'Remove the key capture, or keep it local to the component that needs it.',
  },
  {
    id: 'behavior.exfil-endpoint', category: 'exfiltration', severity: 'HIGH', weight: 25, attack: 'T1567', scope: 'line',
    title: 'References a paste, webhook or tunnelling endpoint used to exfiltrate data',
    pattern: /discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services|api\.telegram\.org\/bot|pastebin\.com|\.ngrok(?:-free)?\.(?:io|app|dev)\b|interact\.sh|\boast\.(?:pro|live|site|online|fun|me)\b/i,
    remediation: 'Send data only to hosts the project owns.',
  },
];
