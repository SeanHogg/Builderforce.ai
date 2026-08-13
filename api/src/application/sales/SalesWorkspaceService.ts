import { and, desc, eq, getTableColumns, isNotNull, or } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessionMembers, creationSessions, salesAssociateSettings, salesCampaigns,
  salesCanvasSessions, salesCoachingNotes, salesCommissionRules, salesContacts,
  salesReferrals, salesWeeklyGoals, users,
} from '../../infrastructure/database/schema';
import { notify } from '../notifications/notify';
import { buildSalesReport } from './salesReports';

export type SalesWorkspaceDb = Db;

export class SalesWorkspaceService {
  constructor(private readonly db: Db) {}

  async viewer(userId: string) {
    const [row] = await this.db.select({ id: users.id, email: users.email, displayName: users.displayName, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, accountType: users.accountType, isSuperadmin: users.isSuperadmin }).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  }

  async owner(userId: string, requestedId?: string): Promise<{ id: string; admin: boolean } | null> {
    const current = await this.viewer(userId);
    if (!current) return null;
    const requested = requestedId || current.id;
    if (requested === current.id) return current.accountType === 'sales' ? { id: requested, admin: current.isSuperadmin } : null;
    if (!current.isSuperadmin) return null;
    const [associate] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, requested), eq(users.accountType, 'sales'))).limit(1);
    return associate ? { id: requested, admin: true } : null;
  }

  async settings(ownerUserId: string) {
    const referralCode = `BF${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const salesCode = `BS${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const [row] = await this.db.insert(salesAssociateSettings).values({ ownerUserId, referralCode, salesCode })
      .onConflictDoNothing({ target: salesAssociateSettings.ownerUserId }).returning();
    if (row) return row;
    const [existing] = await this.db.select().from(salesAssociateSettings).where(eq(salesAssociateSettings.ownerUserId, ownerUserId)).limit(1);
    return existing;
  }

  async associates() {
    return this.db.select({ id: users.id, email: users.email, name: users.displayName, createdAt: users.createdAt })
      .from(users).where(eq(users.accountType, 'sales')).orderBy(desc(users.createdAt));
  }

  /** The CRO report, for one workspace. `associateUserId` null = every associate
   *  in it (the aggregate). */
  report(tenantId: number, associateUserId: string | null) {
    return buildSalesReport(this.db, tenantId, { associateUserId });
  }

  async claimReferral(userId: string, referralCode: string, env: Env) {
    const current = await this.viewer(userId);
    if (!current) return { authenticated: false, claimed: false };
    if (!current.emailVerifiedAt || Date.now() - current.createdAt.getTime() > 30 * 60_000) return { authenticated: true, claimed: false };
    const [associate] = await this.db.select({ ownerUserId: salesAssociateSettings.ownerUserId, notifyOnSignup: salesAssociateSettings.notifyOnSignup, salesCode: salesAssociateSettings.salesCode })
      .from(salesAssociateSettings).where(or(eq(salesAssociateSettings.referralCode, referralCode), eq(salesAssociateSettings.salesCode, referralCode))).limit(1);
    if (!associate || associate.ownerUserId === current.id) return { authenticated: true, claimed: false };
    const [created] = await this.db.insert(salesReferrals).values({ associateUserId: associate.ownerUserId, referredUserId: current.id, attributionType: referralCode === associate.salesCode ? 'sales' : 'referral', signupNotifiedAt: new Date() }).onConflictDoNothing({ target: salesReferrals.referredUserId }).returning();
    if (created && associate.notifyOnSignup) void notify(this.db, env, { userId: associate.ownerUserId, kind: 'sales.referral_signup', title: 'A referred user signed up', body: `${current.displayName || current.email} verified a Builderforce account through OAuth.`, ref: '/sales' });
    return { authenticated: true, claimed: Boolean(created) };
  }

  async workspace(ownerUserId: string) {
    const [contacts, campaigns, goalRows, notes, referrals, settings, commissionRules] = await Promise.all([
      this.db.select().from(salesContacts).where(eq(salesContacts.ownerUserId, ownerUserId)).orderBy(desc(salesContacts.updatedAt)),
      this.db.select().from(salesCampaigns).where(eq(salesCampaigns.ownerUserId, ownerUserId)).orderBy(desc(salesCampaigns.updatedAt)),
      this.db.select().from(salesWeeklyGoals).where(eq(salesWeeklyGoals.ownerUserId, ownerUserId)).limit(1),
      this.db.select({ id: salesCoachingNotes.id, body: salesCoachingNotes.body, createdAt: salesCoachingNotes.createdAt, authorUserId: salesCoachingNotes.authorUserId, authorName: users.displayName }).from(salesCoachingNotes).leftJoin(users, eq(users.id, salesCoachingNotes.authorUserId)).where(eq(salesCoachingNotes.associateUserId, ownerUserId)).orderBy(desc(salesCoachingNotes.createdAt)),
      this.db.select({ ...getTableColumns(salesReferrals), tenantId: salesReferrals.tenantId }).from(salesReferrals).where(and(eq(salesReferrals.associateUserId, ownerUserId), isNotNull(salesReferrals.signupNotifiedAt))).orderBy(desc(salesReferrals.signedUpAt)),
      this.settings(ownerUserId),
      this.commissionRules(),
    ]);
    return { contacts, campaigns, goals: goalRows[0] ?? { ownerUserId, outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3 }, notes, referrals, settings, commissionRules, performance: { signups: referrals.length, conversions: referrals.filter((row) => row.convertedAt).length, convertedRevenueCents: referrals.reduce((sum, row) => sum + (row.revenueCents ?? 0), 0), earnedCents: referrals.reduce((sum, row) => sum + (row.commissionCents ?? 0), 0) } };
  }

  async canvas(ownerUserId: string, viewerId: string) {
    const [row] = await this.db.select({ sessionId: salesCanvasSessions.sessionId, tenantId: salesCanvasSessions.tenantId }).from(salesCanvasSessions).where(eq(salesCanvasSessions.ownerUserId, ownerUserId)).limit(1);
    const settings = await this.settings(ownerUserId);
    if (!row) return { sessionId: null, referralCode: settings?.referralCode ?? null, salesCode: settings?.salesCode ?? null };
    const current = await this.viewer(viewerId);
    if (current?.isSuperadmin) await this.db.insert(creationSessionMembers).values({ sessionId: row.sessionId, userId: current.id, role: 'editor', invitedBy: current.id }).onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role: 'editor' } });
    return { sessionId: row.sessionId, referralCode: settings?.referralCode ?? null, salesCode: settings?.salesCode ?? null };
  }

  async updateSettings(ownerUserId: string, values: { revenueGoalCents: number; notifyOnSignup: boolean; notifyOnConversion: boolean }) {
    const [row] = await this.db.update(salesAssociateSettings).set({ ...values, updatedAt: new Date() }).where(eq(salesAssociateSettings.ownerUserId, ownerUserId)).returning();
    return row;
  }

  commissionRules() { return this.db.select().from(salesCommissionRules).orderBy(salesCommissionRules.plan, salesCommissionRules.billingCycle); }

  async updateCommissionRules(rules: Array<{ plan: string; billingCycle: string; referralBps: number; salesBps: number }>, updatedBy: string) {
    const statements = rules.map((rule) => this.db.insert(salesCommissionRules).values({ ruleKey: `${rule.plan}:${rule.billingCycle}`, ...rule, updatedBy }).onConflictDoUpdate({ target: salesCommissionRules.ruleKey, set: { referralBps: rule.referralBps, salesBps: rule.salesBps, updatedBy, updatedAt: new Date() } }));
    await this.db.batch(statements as unknown as Parameters<typeof this.db.batch>[0]);
    return this.commissionRules();
  }

  async setCanvas(ownerUserId: string, viewerId: string, sessionId: string) {
    const [session] = await this.db.select({ id: creationSessions.id, createdBy: creationSessions.createdBy, tenantId: creationSessions.tenantId }).from(creationSessions).where(eq(creationSessions.id, sessionId)).limit(1);
    if (!session || session.createdBy !== ownerUserId) return null;
    await this.db.insert(salesCanvasSessions).values({ ownerUserId, sessionId: session.id, tenantId: session.tenantId }).onConflictDoUpdate({ target: salesCanvasSessions.ownerUserId, set: { sessionId: session.id, tenantId: session.tenantId } });
    const admins = await this.db.select({ id: users.id }).from(users).where(eq(users.isSuperadmin, true));
    if (admins.length) await this.db.insert(creationSessionMembers).values(admins.map((admin) => ({ sessionId: session.id, userId: admin.id, role: 'editor', invitedBy: viewerId }))).onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role: 'editor' } });
    return session.id;
  }

  async createContact(ownerUserId: string, values: { name: string; email: string; company: string; market: string; stage: string }) { const [row] = await this.db.insert(salesContacts).values({ ownerUserId, ...values }).returning(); return row; }
  async updateContact(ownerUserId: string, id: string, patch: Record<string, unknown>) { const [row] = await this.db.update(salesContacts).set(patch).where(and(eq(salesContacts.id, id), eq(salesContacts.ownerUserId, ownerUserId))).returning(); return row; }
  async createCampaign(ownerUserId: string, values: { name: string; market: string; subject: string }) { const [row] = await this.db.insert(salesCampaigns).values({ ownerUserId, ...values }).returning(); return row; }
  async updateCampaign(ownerUserId: string, id: string, patch: Record<string, unknown>) { const [row] = await this.db.update(salesCampaigns).set(patch).where(and(eq(salesCampaigns.id, id), eq(salesCampaigns.ownerUserId, ownerUserId))).returning(); return row; }
  async setGoals(ownerUserId: string, values: { outreachTarget: number; contactsTarget: number; meetingsTarget: number }) { const row = { ownerUserId, ...values, updatedAt: new Date() }; const [saved] = await this.db.insert(salesWeeklyGoals).values(row).onConflictDoUpdate({ target: salesWeeklyGoals.ownerUserId, set: row }).returning(); return saved; }
  async addNote(associateUserId: string, authorUserId: string, body: string) { const [row] = await this.db.insert(salesCoachingNotes).values({ associateUserId, authorUserId, body }).returning(); return row; }
}
