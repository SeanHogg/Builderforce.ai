export interface MediaIceServer { urls: string | string[]; username?: string; credential?: string }

const urlsOf = (server: MediaIceServer) => Array.isArray(server.urls) ? server.urls : [server.urls];

/** Direct-only mode retains host/STUN traversal while making TURN relay impossible. */
export function applyMediaPrivacyMode(servers: MediaIceServer[], directOnly: boolean) {
  return {
    iceServers: directOnly ? servers.filter((server) => urlsOf(server).every((url) => String(url).startsWith('stun:'))) : servers,
    mode: directOnly ? 'direct-only' as const : 'relay-fallback' as const,
    turnEnabled: !directOnly && servers.some((server) => urlsOf(server).some((url) => /^turns?:/.test(String(url)))),
  };
}
