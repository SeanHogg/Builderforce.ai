/** Persisted, provider-neutral inbox automation rules. */
import { and, asc, eq } from 'drizzle-orm';
import type { DbHandle as Db } from '../shared/dbHandle';
import { mailboxAutomationRules, mailboxConnections } from '../../infrastructure/database/schema';

export const MAILBOX_RESPONSE_MODES = ['draft', 'approval', 'automatic'] as const;
export type MailboxResponseMode = typeof MAILBOX_RESPONSE_MODES[number];

export interface MailboxAutomationRuleInput {
  name: string;
  enabled?: boolean;
  fromContains?: string;
  subjectContains?: string;
  agentRef?: string | null;
  responseMode?: MailboxResponseMode;
  instructions?: string;
}

export async function listMailboxAutomationRules(db: Db, tenantId: number, connectionId: number) {
  return db.select().from(mailboxAutomationRules).where(and(
    eq(mailboxAutomationRules.tenantId, tenantId),
    eq(mailboxAutomationRules.connectionId, connectionId),
  )).orderBy(asc(mailboxAutomationRules.id));
}

async function ownsConnection(db: Db, tenantId: number, connectionId: number): Promise<boolean> {
  const [row] = await db.select({ id: mailboxConnections.id }).from(mailboxConnections).where(and(
    eq(mailboxConnections.tenantId, tenantId),
    eq(mailboxConnections.id, connectionId),
  )).limit(1);
  return !!row;
}

export async function createMailboxAutomationRule(
  db: Db, tenantId: number, connectionId: number, input: MailboxAutomationRuleInput,
) {
  if (!(await ownsConnection(db, tenantId, connectionId))) return null;
  const [row] = await db.insert(mailboxAutomationRules).values({
    tenantId,
    connectionId,
    name: input.name.trim(),
    enabled: input.enabled ?? true,
    fromContains: input.fromContains?.trim() ?? '',
    subjectContains: input.subjectContains?.trim() ?? '',
    agentRef: input.agentRef?.trim() || null,
    responseMode: input.responseMode ?? 'draft',
    instructions: input.instructions?.trim() ?? '',
  }).returning();
  return row ?? null;
}

export async function updateMailboxAutomationRule(
  db: Db, tenantId: number, ruleId: number, input: Partial<MailboxAutomationRuleInput>,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.fromContains !== undefined) patch.fromContains = input.fromContains.trim();
  if (input.subjectContains !== undefined) patch.subjectContains = input.subjectContains.trim();
  if (input.agentRef !== undefined) patch.agentRef = input.agentRef?.trim() || null;
  if (input.responseMode !== undefined) patch.responseMode = input.responseMode;
  if (input.instructions !== undefined) patch.instructions = input.instructions.trim();
  const [row] = await db.update(mailboxAutomationRules).set(patch).where(and(
    eq(mailboxAutomationRules.tenantId, tenantId),
    eq(mailboxAutomationRules.id, ruleId),
  )).returning();
  return row ?? null;
}

export async function deleteMailboxAutomationRule(db: Db, tenantId: number, ruleId: number): Promise<boolean> {
  const rows = await db.delete(mailboxAutomationRules).where(and(
    eq(mailboxAutomationRules.tenantId, tenantId),
    eq(mailboxAutomationRules.id, ruleId),
  )).returning({ id: mailboxAutomationRules.id });
  return rows.length > 0;
}
