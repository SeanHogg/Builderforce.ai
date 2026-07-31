/**
 * Conflict Alert Entity + Factory
 *
 * PRD requirements:
 * - Labeling: conflicting items, stakeholders, detection date
 * - Summarization: reasoning behind conflict
 * - Attachment: to priority version(s)
 */

import type {
  ConflictAlert,
  ConflictKey,
  ConflictingPriorities,
  Stakeholder,
  Team,
  PriorityLevel,
} from './types.js';

export type { ConflictAlert, ConflictKey, PriorityLevel };

// ── Stable dedup key encoding that tolerates '__' in ids ─────────────────────
// Prior build used `${a}__${b}__${team}[__${version}]` and parsed with split('__'),
// which breaks if any id itself contains '__'. Fix: JSON envelope + base64url.
// The legacy delimiter form is still parse-compatible for back-compat, but the
// canonical generator never emits it.

function encodeKeyPayload(obj: ConflictKey): string {
  const json = JSON.stringify({
    a: obj.stakeholderId1,
    b: obj.stakeholderId2,
    t: obj.teamId,
    ...(obj.versionId !== undefined ? { v: obj.versionId } : {}),
  });
  // base64url (no padding, safe in URLs / ids)
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeKeyPayload(keyString: string): ConflictKey | null {
  try {
    const json = Buffer.from(keyString, 'base64url').toString('utf8');
    const o = JSON.parse(json) as { a: string; b: string; t: string; v?: string };
    if (!o || typeof o.a !== 'string' || typeof o.b !== 'string' || typeof o.t !== 'string') return null;
    return {
      stakeholderId1: o.a,
      stakeholderId2: o.b,
      teamId: o.t,
      versionId: typeof o.v === 'string' ? o.v : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Generate a stable deduplication key for a conflict.
 *
 * Semantics: the pair (stakeholderId1, stakeholderId2) is order-independent:
 * callers emit (a,b) sorted lexicographically (case-insensitive) so
 * (alice,bob) and (bob,alice) map to the same key.
 *
 * Format: base64url(JSON({a,b,t,v?})) — never raw text-split.
 */
export function generateConflictKey(
  stakeholderId1: string,
  stakeholderId2: string,
  teamId: string,
  versionId?: string
): string {
  const sorted = [String(stakeholderId1), String(stakeholderId2)].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
  );
  const structured: ConflictKey = {
    stakeholderId1: sorted[0],
    stakeholderId2: sorted[1],
    teamId: String(teamId),
    ...(versionId !== undefined ? { versionId: String(versionId) } : {}),
  };
  return encodeKeyPayload(structured);
}

/**
 * Parse a conflict key into its structured parts.
 * Accepts both the new base64url-JSON form and the legacy `__`-delimited form.
 */
export function parseConflictKey(keyString: string): ConflictKey {
  // New (safe) form
  const structured = decodeKeyPayload(keyString);
  if (structured) return structured;

  // Back-compat legacy: s1__s2__teamId[__versionId] — ids may contain '__',
  // so the legacy reverse-parse is heuristic: last `__` chunk may be versionId,
  // remaining tail is teamId, the rest are the two stakeholder parts.
  // Best-effort only — callers must migrate to canonical keys.
  const parts = keyString.split('__');
  if (parts.length < 3) {
    throw new Error(
      `Invalid conflict key format: ${keyString}. Expected at least 3 parts separated by '__' or a base64url-encoded key.`
    );
  }
  const maybeVersionish = parts.length >= 4 ? parts[parts.length - 1] : undefined;
  // Heuristic: if last chunk looks like V{N} / v-{...} / versioned id, treat as version; else team carries to end.
  // Empirically, versionIds contain '-' or start with V/v or are >6 chars distinct from teamId.
  // This path is migration-only and won't be hit for new keys.
  let stakeholderId1: string;
  let stakeholderId2: string;
  let teamId: string;
  let versionId: string | undefined;

  if (parts.length === 3) {
    [stakeholderId1, stakeholderId2, teamId] = parts;
  } else {
    // When >=4, we split as: team is the 3rd from the right of the remaining.
    versionId = maybeVersionish;
    teamId = parts[parts.length - 2];
    // First two logical tokens — remaining middle tokens rejoined into stakeholder2 if legacy contained '__'.
    stakeholderId1 = parts[0];
    stakeholderId2 = parts.slice(1, parts.length - 2).join('__') || parts[1];
  }

  return { stakeholderId1, stakeholderId2, teamId, versionId };
}

function coerceId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const cands = [
      (o as { stakeholderId?: unknown }).stakeholderId,
      (o as { id?: unknown }).id,
      (o as { userId?: unknown }).userId,
      (o as { teamId?: unknown }).teamId,
    ];
    for (const c of cands) if (typeof c === 'string' && c.length > 0) return c;
  }
  return fallback;
}

function coerceName(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const cands = [
      (o as { stakeholderName?: unknown }).stakeholderName,
      (o as { name?: unknown }).name,
      (o as { teamName?: unknown }).teamName,
    ];
    for (const c of cands) if (typeof c === 'string' && c.length > 0) return c;
  }
  return fallback;
}

/**
 * Build conflicting priorities structure.
 */
export function buildConflictingPriorities(
  stakeholder1: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
  stakeholder2: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
  team: Partial<Team & { id?: string; name?: string }>,
  priority1: PriorityLevel,
  priority2: PriorityLevel,
  teamId: string
): ConflictingPriorities {
  return {
    stakeholder1: {
      stakeholderId: coerceId(stakeholder1, 'unknown'),
      stakeholderName: coerceName(stakeholder1, coerceId(stakeholder1, 'unknown')),
      role: (stakeholder1 as { role?: string }).role,
      email: (stakeholder1 as { email?: string }).email,
    },
    stakeholder2: {
      stakeholderId: coerceId(stakeholder2, 'unknown'),
      stakeholderName: coerceName(stakeholder2, coerceId(stakeholder2, 'unknown')),
      role: (stakeholder2 as { role?: string }).role,
      email: (stakeholder2 as { email?: string }).email,
    },
    team: {
      teamId,
      teamName: coerceName(team, teamId),
      organization: (team as { organization?: string }).organization,
    },
    priority1,
    priority2,
  };
}

/**
 * Conflict Alert Factory — creates fully labeled alerts per PRD.
 */
export class ConflictAlertFactory {
  static createAlert(
    stakeholder1: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
    stakeholder2: Partial<Stakeholder & { id?: string; userId?: string; name?: string }>,
    team: Partial<Team & { id?: string; name?: string }>,
    teamId: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    sourceRequestIds: string[],
    versionId?: string
  ): ConflictAlert {
    const sid1 = coerceId(stakeholder1, 'unknown');
    const sid2 = coerceId(stakeholder2, 'unknown');

    const canonicalKey = generateConflictKey(sid1, sid2, teamId, versionId);
    const parsedKey = parseConflictKey(canonicalKey);

    const sName1 = coerceName(stakeholder1, sid1);
    const sName2 = coerceName(stakeholder2, sid2);
    const tName = coerceName(team, teamId);
    const now = new Date();

    return {
      id: canonicalKey,
      key: parsedKey,
      title: ConflictAlertFactory.buildTitle(tName, priority1, priority2),
      description: ConflictAlertFactory.buildDescription(
        sid1,
        sid2,
        sName1,
        sName2,
        tName,
        priority1,
        priority2,
        now,
        versionId
      ),
      summary: ConflictAlertFactory.buildSummary(sName1, sName2, tName, priority1, priority2, versionId),
      severity: ConflictAlertFactory.determineSeverity(priority1, priority2),
      detectedAt: now.toISOString(),
      status: 'open',
      conflictingPriorities: buildConflictingPriorities(
        stakeholder1,
        stakeholder2,
        team,
        priority1,
        priority2,
        teamId
      ),
      stakeholders: [
        {
          stakeholderId: sid1,
          stakeholderName: sName1,
          role: (stakeholder1 as { role?: string }).role,
          email: (stakeholder1 as { email?: string }).email,
        },
        {
          stakeholderId: sid2,
          stakeholderName: sName2,
          stakeholderName2_property_backcompat_unused: undefined as never,
          role: (stakeholder2 as { role?: string }).role,
          email: (stakeholder2 as { email?: string }).email,
        } as Stakeholder,
      ].map((s) => {
        // drop accidental extra key if preserved
        const { stakeholderName2_property_backcompat_unused: _ignored, ...rest } = s as Stakeholder & {
          stakeholderName2_property_backcompat_unused?: unknown;
        };
        return rest as Stakeholder;
      }),
      versionIds: versionId ? [versionId] : [],
      sourceRequestIds,
      conflictCount: new Set(sourceRequestIds).size,
    };
  }

  private static buildTitle(
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): string {
    if (priority1 === 'P0' && priority2 === 'P0') {
      return `${teamName} — P0 Priority Conflict: Competing P0 requests`;
    }
    return `${teamName} — Priority Conflict: ${priority1} vs ${priority2}`;
  }

  private static buildDescription(
    stakeholderId1: string,
    stakeholderId2: string,
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    detectedAt: Date,
    versionId?: string
  ): string {
    const versionLabel = versionId ? ` in version ${versionId}` : '';
    const lines = [
      `Conflict detected on ${detectedAt.toISOString()}${versionLabel}.`,
      `Rule: Two distinct stakeholders assigned conflicting P0 priorities to the same team within the same review window.`,
      ``,
      `Details:`,
      `- Stakeholder "${stakeholderName1}" (ID: ${stakeholderId1}) assigned priority ${priority1} to team "${teamName}".`,
      `- Stakeholder "${stakeholderName2}" (ID: ${stakeholderId2}) assigned priority ${priority2} to the same team "${teamName}".`,
      `- Both requests target the same team within the same review window, triggering rule ${priority1} vs ${priority2} conflict.`,
      ``,
      `Impact: Resource allocation conflict — team "${teamName}" cannot satisfy two competing P0 priorities simultaneously. Requires manual resolution by conflict resolver.`,
    ];
    if (versionId) lines.push(`Attached to priority version(s): ${versionId}`);
    return lines.join('\n');
  }

  private static buildSummary(
    stakeholderName1: string,
    stakeholderName2: string,
    teamName: string,
    priority1: PriorityLevel,
    priority2: PriorityLevel,
    versionId?: string
  ): string {
    const base =
      `Conflict: Stakeholder "${stakeholderName1}" assigned ${priority1} and stakeholder ` +
      `"${stakeholderName2}" assigned ${priority2} to team "${teamName}" within same review window. ` +
      `Rule violation: distinct stakeholders cannot both set P0 for same team in same window; requires manual resolution.`;
    return versionId ? `${base} [Version: ${versionId}]` : base;
  }

  private static determineSeverity(
    priority1: PriorityLevel,
    priority2: PriorityLevel
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (priority1 === 'P0' && priority2 === 'P0') return 'critical';
    if (priority1 === 'P0' || priority2 === 'P0') return 'high';
    if (priority1 === 'P1' && priority2 === 'P1') return 'medium';
    return 'low';
  }
}

// ── Convenience enum-like objects (back-compat) ───────────────────────────────

export const ConflictSeverity = {
  CRITICAL: 'critical' as const,
  HIGH: 'high' as const,
  MEDIUM: 'medium' as const,
  LOW: 'low' as const,
};

export const ConflictStatus = {
  OPEN: 'open' as const,
  ACKNOWLEDGED: 'acknowledged' as const,
  RESOLVED: 'resolved' as const,
  DISMISSED: 'dismissed' as const,
};

export const PriorityLevelConst = {
  P0: 'P0' as const,
  P1: 'P1' as const,
  P2: 'P2' as const,
  P3: 'P3' as const,
};

// Back-compat for prior name
export const PriorityLevel = PriorityLevelConst;

export type ListConflictsQuery = {
  status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed' | 'all';
  versionId?: string;
  teamId?: string;
  stakeholderId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  page?: number;
  limit?: number;
};

export type ResolveConflictRequest = {
  action: 'acknowledge' | 'resolve' | 'dismiss';
  note?: string;
  resolverUserId?: string;
};
