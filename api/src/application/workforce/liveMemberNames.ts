/**
 * liveMemberNames — resolve a workforce member's CURRENT display name from its
 * canonical source, so a denormalized `team_members.member_name` (snapshotted when the
 * member was added) never shows a stale name after the underlying human or agent is
 * renamed.
 *
 * `member_name` is kept denormalized for cheap list rendering, but the name of a human
 * (`users.display_name`), a cloud agent (`ide_agents.name`), or a host agent
 * (`agent_hosts.name`) can change afterwards. This helper batch-loads the live names
 * for a set of members (three grouped `IN` queries, never N+1) and overrides the
 * stored copy, falling back to the stored value when the source row is gone.
 */
import { inArray } from 'drizzle-orm';
import { users, ideAgents, agentHosts } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface MemberNameRef {
  memberKind: string; // 'human' | 'cloud_agent' | 'host_agent'
  memberRef: string;
  memberName: string;
}

/** Return the members with `memberName` refreshed to the live canonical name. */
export async function resolveLiveMemberNames<T extends MemberNameRef>(db: Db, members: T[]): Promise<T[]> {
  if (members.length === 0) return members;

  const humanIds = [...new Set(members.filter((m) => m.memberKind === 'human').map((m) => m.memberRef))];
  const cloudIds = [...new Set(members.filter((m) => m.memberKind === 'cloud_agent').map((m) => m.memberRef))];
  const hostIds = [...new Set(members.filter((m) => m.memberKind === 'host_agent').map((m) => Number(m.memberRef)).filter(Number.isFinite))];

  const [humanRows, cloudRows, hostRows] = await Promise.all([
    humanIds.length
      ? db.select({ id: users.id, displayName: users.displayName, username: users.username, email: users.email }).from(users).where(inArray(users.id, humanIds))
      : Promise.resolve([]),
    cloudIds.length
      ? db.select({ id: ideAgents.id, name: ideAgents.name }).from(ideAgents).where(inArray(ideAgents.id, cloudIds))
      : Promise.resolve([]),
    hostIds.length
      ? db.select({ id: agentHosts.id, name: agentHosts.name }).from(agentHosts).where(inArray(agentHosts.id, hostIds))
      : Promise.resolve([]),
  ]);

  const humanName = new Map(humanRows.map((r) => [r.id, (r.displayName || r.username || r.email || '').trim()]));
  const cloudName = new Map(cloudRows.map((r) => [r.id, (r.name || '').trim()]));
  const hostName = new Map(hostRows.map((r) => [String(r.id), (r.name || '').trim()]));

  return members.map((m) => {
    const live =
      m.memberKind === 'human' ? humanName.get(m.memberRef)
        : m.memberKind === 'cloud_agent' ? cloudName.get(m.memberRef)
          : hostName.get(m.memberRef);
    return live ? { ...m, memberName: live } : m;
  });
}
