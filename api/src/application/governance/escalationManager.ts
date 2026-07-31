/**
 * Escalation Manager Service - lifecycle: start, resolve, notify, deadline
 * FR.2 FR.3 FR.5 / AC.2 AC.3 AC.5
 */
export type EscalationLevelDef = {
  initiativeId: string
  effectiveLevel: number
  sequence: number
  roleKey: string
  assigneeId?: string
  teamScope?: string
}
export type EscalationChainDef = {
  initiativeId: string
  teamScope: string
  levels: EscalationLevelDef[]
  isActive: boolean
  defaultSlaBusinessDays: number
}
export type EscalationEvent = {
  id: string
  initiativeId: string
  teamScope: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'triggered' | 'active' | 'escalated' | 'resolved' | 'closed'
  currentLevel: number
  triggeredAt: Date
  slaStartedAt?: Date
  currentDeadline?: Date
  assigneeRole: string
  assigneeId?: string
  createdBy: string
}
export type EscalationResolutionLog = {
  escalationId: string
  level: number
  resolvedAt: Date
  outcome: string
  slaBreached: boolean
  stepsTaken: string[]
  resolutionOptions: string[]
  resolvedBy: string
  notes?: string
}
const BUSINESS_DAYS_SLA = 3
const SLA_START_MAX_DELAY_MIN = 15
export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}
export function addBusinessDays(start: Date, days: number): Date {
  let d = new Date(start)
  let added = 0
  while (added < days) {
    d = new Date(d.getTime() + 86400000)
    if (!isWeekend(d)) added++
  }
  d.setUTCHours(17, 0, 0, 0)
  return d
}
export function computeDeadline(triggeredAt: Date, businessDays = BUSINESS_DAYS_SLA): Date {
  return addBusinessDays(triggeredAt, businessDays)
}
export function isSlaBreached(deadline: Date, now = new Date()): boolean {
  return now.getTime() > deadline.getTime()
}
export function slaStartedWithinLimit(triggeredAt: Date, slaStartedAt: Date): boolean {
  const diff = (slaStartedAt.getTime() - triggeredAt.getTime()) / 60000
  return diff >= 0 && diff <= SLA_START_MAX_DELAY_MIN
}
export type ReminderKind = '24h' | '4h'
export function computeReminderTimes(deadline: Date): { kind: ReminderKind; fireAt: Date }[] {
  return [
    { kind: '24h', fireAt: new Date(deadline.getTime() - 86400000) },
    { kind: '4h', fireAt: new Date(deadline.getTime() - 14400000) },
  ]
}
export function shouldFireReminder(fireAt: Date, now = new Date(), windowMinutes = 10): boolean {
  const diffMin = (now.getTime() - fireAt.getTime()) / 60000
  return diffMin >= 0 && diffMin <= windowMinutes
}
export interface EscalationNotificationAdapter {
  notify(payload: {
    escalationId: string
    level: number
    assigneeRole: string
    assigneeId?: string
    kind: 'triggered' | 'escalated' | 'reminder_24h' | 'reminder_4h' | 'resolved'
    initiativeId: string
    title: string
    deadline?: Date
  }): Promise<void>
}
export class ConsoleNotificationAdapter implements EscalationNotificationAdapter {
  async notify(p: { escalationId: string; level: number; assigneeRole: string; kind: string; title: string; deadline?: Date }): Promise<void> {
    console.log(`[Escalation:${p.kind}] ${p.escalationId} L${p.level} -> ${p.assigneeRole} deadline=${p.deadline?.toISOString()} "${p.title}"`)
  }
}
export class EscalationManager {
  private chains = new Map<string, EscalationChainDef>()
  private notifications: EscalationNotificationAdapter
  constructor(adapter?: EscalationNotificationAdapter) {
    this.notifications = adapter ?? new ConsoleNotificationAdapter()
  }
  upsertChain(chain: EscalationChainDef): void {
    if (chain.levels.length < 3) throw new Error('Chain must have >=3 levels (AC.1)')
    const sorted = [...chain.levels].sort((a, b) => a.sequence - b.sequence)
    for (let i = 0; i < sorted.length; i++) if (sorted[i].sequence !== i + 1) throw new Error(`Sequence must be 1..n, got ${sorted[i].sequence}`)
    this.chains.set(this.chainKey(chain.initiativeId, chain.teamScope), { ...chain, levels: sorted })
  }
  getChain(initiativeId: string, teamScope: string): EscalationChainDef | undefined {
    return this.chains.get(this.chainKey(initiativeId, teamScope))
  }
  async startEscalation(input: {
    initiativeId: string
    teamScope: string
    title: string
    description: string
    severity: EscalationEvent['severity']
    createdBy: string
  }): Promise<EscalationEvent> {
    const chain = this.getChain(input.initiativeId, input.teamScope)
    if (!chain) throw new Error(`No chain for ${input.initiativeId}/${input.teamScope}`)
    if (!chain.isActive) throw new Error('Chain inactive')
    const l1 = chain.levels[0]
    const now = new Date()
    const deadline = computeDeadline(now, chain.defaultSlaBusinessDays ?? BUSINESS_DAYS_SLA)
    const event: EscalationEvent = {
      id: crypto.randomUUID(),
      initiativeId: input.initiativeId,
      teamScope: input.teamScope,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: 'active',
      currentLevel: l1.effectiveLevel,
      triggeredAt: now,
      slaStartedAt: now,
      currentDeadline: deadline,
      assigneeRole: l1.roleKey,
      assigneeId: l1.assigneeId,
      createdBy: input.createdBy,
    }
    await this.notifications.notify({
      escalationId: event.id,
      level: event.currentLevel,
      assigneeRole: event.assigneeRole,
      assigneeId: event.assigneeId,
      kind: 'triggered',
      initiativeId: event.initiativeId,
      title: event.title,
      deadline: event.currentDeadline,
    })
    return event
  }
  shouldAutoEscalate(event: EscalationEvent, now = new Date()): boolean {
    if (!event.currentDeadline) return false
    if (event.status !== 'active' && event.status !== 'escalated') return false
    return isSlaBreached(event.currentDeadline, now)
  }
  async autoEscalate(event: EscalationEvent): Promise<EscalationEvent | null> {
    if (!this.shouldAutoEscalate(event)) return null
    const chain = this.getChain(event.initiativeId, event.teamScope)
    if (!chain) return null
    const idx = chain.levels.findIndex((l) => l.effectiveLevel === event.currentLevel)
    if (idx === -1 || idx >= chain.levels.length - 1) return null
    const next = chain.levels[idx + 1]
    const now = new Date()
    const deadline = computeDeadline(now, chain.defaultSlaBusinessDays ?? BUSINESS_DAYS_SLA)
    const escalated: EscalationEvent = {
      ...event,
      currentLevel: next.effectiveLevel,
      status: 'escalated',
      slaStartedAt: now,
      currentDeadline: deadline,
      assigneeRole: next.roleKey,
      assigneeId: next.assigneeId,
    }
    await this.notifications.notify({
      escalationId: escalated.id,
      level: escalated.currentLevel,
      assigneeRole: escalated.assigneeRole,
      assigneeId: escalated.assigneeId,
      kind: 'escalated',
      initiativeId: escalated.initiativeId,
      title: escalated.title,
      deadline: escalated.currentDeadline,
    })
    return escalated
  }
  async resolveEscalation(
    event: EscalationEvent,
    resolution: { outcome: string; stepsTaken: string[]; resolutionOptions: string[]; resolvedBy: string; notes?: string },
    now = new Date(),
  ): Promise<{ event: EscalationEvent; log: EscalationResolutionLog }> {
    if (!resolution.outcome?.trim()) throw new Error('outcome required (AC.5)')
    if (!resolution.stepsTaken?.length) throw new Error('stepsTaken required (AC.5)')
    if (!resolution.resolutionOptions?.length) throw new Error('resolutionOptions required (AC.5)')
    const deadline = event.currentDeadline ?? computeDeadline(event.triggeredAt)
    const breached = isSlaBreached(deadline, now)
    const log: EscalationResolutionLog = {
      escalationId: event.id,
      level: event.currentLevel,
      resolvedAt: now,
      outcome: resolution.outcome,
      slaBreached: breached,
      stepsTaken: resolution.stepsTaken,
      resolutionOptions: resolution.resolutionOptions,
      resolvedBy: resolution.resolvedBy,
      notes: resolution.notes,
    }
    const resolvedEvent: EscalationEvent = { ...event, status: 'resolved' }
    await this.notifications.notify({
      escalationId: resolvedEvent.id,
      level: resolvedEvent.currentLevel,
      assigneeRole: resolvedEvent.assigneeRole,
      assigneeId: resolvedEvent.assigneeId,
      kind: 'resolved',
      initiativeId: resolvedEvent.initiativeId,
      title: resolvedEvent.title,
    })
    return { event: resolvedEvent, log }
  }
  private chainKey(initiativeId: string, teamScope: string): string {
    return `${initiativeId}::${teamScope}`
  }
}
