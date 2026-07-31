/**
 * OnCallService — on-call rotations and "who is on call right now".
 *
 * A rotation is a named, ordered on-call list. Who is on call is resolved from the
 * ordered members by the rotation kind:
 *   • manual — the member at currentIndex (advanced by hand / by the sweep);
 *   • daily  — day-of-year mod member-count (rotates every day);
 *   • weekly — ISO-week mod member-count (rotates every week).
 *
 * A member_ref is assignee-encoded — 'u:<userId>' | 'c:<agentRef>' |
 * 'contact:<businessContactId>' — so a rotation can page humans, agents, or external
 * business contacts uniformly; incidentNotifier expands a ref into delivery channels.
 */
import { and, asc, eq } from 'drizzle-orm';
import { onCallRotations, onCallMembers } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export type RotationKind = 'manual' | 'daily' | 'weekly';

export interface OnCallMemberInput {
  memberRef: string;
  displayName?: string | null;
  position?: number;
}

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86_400_000);
}
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export class OnCallService {
  constructor(private readonly db: Db) {}

  async createRotation(tenantId: number, input: { name: string; description?: string | null; rotationKind?: RotationKind; projectId?: number | null }) {
    const [row] = await this.db.insert(onCallRotations).values({
      tenantId,
      name: input.name.slice(0, 255),
      description: input.description ?? undefined,
      rotationKind: input.rotationKind ?? 'manual',
      projectId: input.projectId ?? undefined,
    }).returning();
    return row!;
  }

  async listRotations(tenantId: number) {
    const rotations = await this.db.select().from(onCallRotations)
      .where(eq(onCallRotations.tenantId, tenantId)).orderBy(asc(onCallRotations.name));
    const out = [];
    for (const r of rotations) {
      const members = await this.membersOf(r.id);
      out.push({ ...r, members, onCall: this.currentMember(r.rotationKind as RotationKind, r.currentIndex, members) });
    }
    return out;
  }

  async membersOf(rotationId: string) {
    return this.db.select().from(onCallMembers)
      .where(eq(onCallMembers.rotationId, rotationId)).orderBy(asc(onCallMembers.position));
  }

  private async ownedRotation(tenantId: number, rotationId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: onCallRotations.id }).from(onCallRotations)
      .where(and(eq(onCallRotations.id, rotationId), eq(onCallRotations.tenantId, tenantId))).limit(1);
    return !!row;
  }

  async addMember(tenantId: number, rotationId: string, input: OnCallMemberInput) {
    if (!(await this.ownedRotation(tenantId, rotationId))) throw new Error('Rotation not found in workspace');
    const existing = await this.membersOf(rotationId);
    const position = input.position ?? existing.length;
    const [row] = await this.db.insert(onCallMembers).values({
      tenantId, rotationId, memberRef: input.memberRef.slice(0, 72), displayName: input.displayName ?? undefined, position,
    }).returning();
    return row!;
  }

  async removeMember(tenantId: number, rotationId: string, memberId: string): Promise<void> {
    if (!(await this.ownedRotation(tenantId, rotationId))) throw new Error('Rotation not found in workspace');
    await this.db.delete(onCallMembers).where(and(eq(onCallMembers.id, memberId), eq(onCallMembers.rotationId, rotationId)));
  }

  async updateRotation(tenantId: number, rotationId: string, patch: { name?: string; description?: string | null; rotationKind?: RotationKind; active?: boolean; currentIndex?: number }): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.slice(0, 255);
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.rotationKind !== undefined) set.rotationKind = patch.rotationKind;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.currentIndex !== undefined) set.currentIndex = patch.currentIndex;
    await this.db.update(onCallRotations).set(set).where(and(eq(onCallRotations.id, rotationId), eq(onCallRotations.tenantId, tenantId)));
  }

  async deleteRotation(tenantId: number, rotationId: string): Promise<void> {
    await this.db.delete(onCallRotations).where(and(eq(onCallRotations.id, rotationId), eq(onCallRotations.tenantId, tenantId)));
  }

  /** The member on call for a rotation kind + members (round-robin by time or index). */
  private currentMember(kind: RotationKind, currentIndex: number, members: Array<{ memberRef: string; displayName: string | null }>) {
    if (members.length === 0) return null;
    let idx = currentIndex;
    const now = new Date();
    if (kind === 'daily') idx = dayOfYear(now);
    else if (kind === 'weekly') idx = isoWeek(now);
    const m = members[((idx % members.length) + members.length) % members.length]!;
    return { memberRef: m.memberRef, displayName: m.displayName };
  }

  /** Resolve the member ref(s) currently on call for a rotation (tenant-scoped). */
  async resolveOnCall(tenantId: number, rotationId: string): Promise<Array<{ memberRef: string; displayName: string | null }>> {
    const [rotation] = await this.db.select().from(onCallRotations)
      .where(and(eq(onCallRotations.id, rotationId), eq(onCallRotations.tenantId, tenantId))).limit(1);
    if (!rotation || !rotation.active) return [];
    const members = await this.membersOf(rotationId);
    const current = this.currentMember(rotation.rotationKind as RotationKind, rotation.currentIndex, members);
    return current ? [current] : [];
  }
}
