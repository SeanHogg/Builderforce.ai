/**
 * Wire adapters for the RELIABILITY reads — incidents, on-call, escalation,
 * the business-contact directory and the monitoring roll-up.
 *
 * These are the reads behind `/incidents`, and they were the loudest hole in the
 * sample workspace: every one of its six tabs fired an authenticated GET, every
 * one came back 401, and the page answered with a red card reading
 * `Missing or malformed Authorization header`. A guest was therefore shown the
 * "You are looking at a sample workspace" banner directly above six tabs of
 * server errors — the surface admitted it was a demo and then failed to be one.
 *
 * WHY THIS WORKSPACE HAS AN INCIDENT AT ALL. It would be easier to answer every
 * read with an empty list, and it would be dishonest in the direction that
 * matters: a reliability console with nothing in it demonstrates nothing, and a
 * visitor cannot tell "this product has no incident view" from "this workspace
 * has had no incidents". So Nova Commerce has one open SEV2 against checkout —
 * the flow `SHOP-1` is rebuilding, which is the point: the incident, the ticket
 * and the monitor are the SAME work seen from three seats, and that is the
 * argument the page exists to make.
 *
 * Every id is a `sample-` string. Ids here are never numeric and never
 * UUID-shaped, for the same reason `SAMPLE_TENANT_ID` is not a number: a fixture
 * id that could pass for a real one is a fixture id that will eventually be
 * written somewhere real.
 */

import { SAMPLE_MEMBERS } from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

/** Hours, expressed as the day offsets the rest of the fixtures speak in. */
const HOURS = 1 / 24;

/** The people the rotation and the escalation ladder point at — the SAME roster
 *  the workforce and delivery lenses draw, so a guest who reads on-call and then
 *  opens Workforce meets the same names rather than a second cast. */
const [ATLAS, VEGA, JUNO, HUMAN] = SAMPLE_MEMBERS;

function incidents(now: number) {
  return [
    {
      id: 'sample-inc-1',
      title: 'Checkout latency above 2s at the payment step',
      severity: 'sev2',
      status: 'acknowledged',
      source: 'monitor',
      affectedSystem: 'checkout',
      boardTaskId: 'SHOP-2',
      warRoomChatId: null,
      escalationLevel: 1,
      startedAt: dayOffsetToIso(now, -3 * HOURS),
      acknowledgedAt: dayOffsetToIso(now, -2.6 * HOURS),
      resolvedAt: null,
      impact: 'Express wallet purchases fall back to the long form. Conversion down ~4% on mobile.',
      rootCause: null,
      externalUrl: null,
      postmortemUrl: null,
    },
    {
      id: 'sample-inc-2',
      title: 'Catalog search returned stale prices for 18 minutes',
      severity: 'sev3',
      status: 'resolved',
      source: 'manual',
      affectedSystem: 'catalog',
      boardTaskId: null,
      warRoomChatId: null,
      escalationLevel: 0,
      startedAt: dayOffsetToIso(now, -6),
      acknowledgedAt: dayOffsetToIso(now, -6 + 0.1 * HOURS),
      resolvedAt: dayOffsetToIso(now, -6 + 0.3 * HOURS),
      impact: 'Search results showed the previous price list. No orders were mispriced — checkout re-reads.',
      rootCause: 'Cache invalidation ran before the price import committed.',
      externalUrl: null,
      postmortemUrl: null,
    },
    {
      id: 'sample-inc-3',
      title: 'Nightly order export failed to upload',
      severity: 'sev4',
      status: 'resolved',
      source: 'monitor',
      affectedSystem: 'orders',
      boardTaskId: null,
      warRoomChatId: null,
      escalationLevel: 0,
      startedAt: dayOffsetToIso(now, -19),
      acknowledgedAt: dayOffsetToIso(now, -19 + 0.4 * HOURS),
      resolvedAt: dayOffsetToIso(now, -19 + 1.2 * HOURS),
      impact: 'Finance received the export 70 minutes late. No data lost.',
      rootCause: 'Expired credential on the warehouse bucket.',
      externalUrl: null,
      postmortemUrl: null,
    },
  ];
}

/** Open in the product's sense — anything not yet resolved. Derived from the
 *  rows rather than a second flag on each one, so `?activeOnly=true` and the
 *  roll-up below can never disagree about what "active" means. */
function isActive(incident: { resolvedAt: string | null }): boolean {
  return incident.resolvedAt == null;
}

function rotations() {
  return [
    {
      id: 'sample-rot-1',
      name: 'Storefront primary',
      description: 'First responder for checkout, catalog and orders.',
      rotationKind: 'weekly',
      currentIndex: 0,
      active: true,
      members: [
        { id: 'sample-rot-1-m1', memberRef: ATLAS.slug, displayName: ATLAS.name, position: 0 },
        { id: 'sample-rot-1-m2', memberRef: VEGA.slug, displayName: VEGA.name, position: 1 },
        { id: 'sample-rot-1-m3', memberRef: HUMAN.slug, displayName: HUMAN.name, position: 2 },
      ],
      onCall: { memberRef: ATLAS.slug, displayName: ATLAS.name },
    },
    {
      id: 'sample-rot-2',
      name: 'Escalation — delivery',
      description: 'Paged when the primary does not acknowledge inside 15 minutes.',
      rotationKind: 'manual',
      currentIndex: 0,
      active: true,
      members: [
        { id: 'sample-rot-2-m1', memberRef: JUNO.slug, displayName: JUNO.name, position: 0 },
        { id: 'sample-rot-2-m2', memberRef: HUMAN.slug, displayName: HUMAN.name, position: 1 },
      ],
      onCall: { memberRef: JUNO.slug, displayName: JUNO.name },
    },
  ];
  // No `now`: a rotation carries no timestamps in its wire shape, so there is
  // nothing here to resolve against the read's clock.
}

function policies() {
  return [
    {
      id: 'sample-esc-1',
      name: 'Customer-facing outage',
      description: 'Anything a shopper can see. Pages the primary immediately.',
      matchSeverity: 'sev2',
      active: true,
      levels: [
        { id: 'sample-esc-1-l1', level: 1, afterMinutes: 0, targetKind: 'oncall_rotation', targetRef: 'sample-rot-1', notifyTeams: true, notifySlack: true, notifyEmail: false },
        { id: 'sample-esc-1-l2', level: 2, afterMinutes: 15, targetKind: 'oncall_rotation', targetRef: 'sample-rot-2', notifyTeams: true, notifySlack: true, notifyEmail: true },
        { id: 'sample-esc-1-l3', level: 3, afterMinutes: 45, targetKind: 'contact', targetRef: 'sample-contact-1', notifyTeams: false, notifySlack: false, notifyEmail: true },
      ],
    },
    {
      id: 'sample-esc-2',
      name: 'Internal degradation',
      description: 'Nothing a shopper sees. Filed, not paged.',
      matchSeverity: 'sev4',
      active: true,
      levels: [
        { id: 'sample-esc-2-l1', level: 1, afterMinutes: 30, targetKind: 'oncall_rotation', targetRef: 'sample-rot-1', notifyTeams: false, notifySlack: true, notifyEmail: false },
      ],
    },
  ];
}

function contacts() {
  return [
    {
      id: 'sample-contact-1',
      name: 'Priya Raman',
      roleTitle: 'VP Engineering',
      company: 'Nova Commerce (Sample)',
      email: 'priya@example.invalid',
      phone: '+1 555 0100',
      teamsId: null,
      notes: 'Final escalation for anything customer-facing past 45 minutes.',
    },
    {
      id: 'sample-contact-2',
      name: 'Northwind Payments',
      roleTitle: 'Payments provider — support desk',
      company: 'Northwind',
      email: 'support@example.invalid',
      phone: '+1 555 0142',
      teamsId: null,
      notes: 'Open a ticket before paging; they require a reference id.',
    },
  ];
  // Addresses are `.invalid` by RFC 2606, so a sample contact cannot be mailed
  // or paged by accident from a screenshot.
}

function boards(now: number) {
  return [
    {
      id: 'sample-board-1',
      name: 'Storefront request path',
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      projectId: 9001,
      monitorCount: 6,
      breachedCount: 1,
      updatedAt: dayOffsetToIso(now, -3 * HOURS),
    },
    {
      id: 'sample-board-2',
      name: 'Order pipeline',
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      projectId: 9001,
      monitorCount: 4,
      breachedCount: 0,
      updatedAt: dayOffsetToIso(now, -2),
    },
  ];
}

/**
 * The Reporting tab — the surface that showed the raw 401 in the report the
 * operator filed.
 *
 * Every number is DERIVED from the rows above rather than typed out beside them.
 * A hand-written roll-up is the fixture equivalent of a denormalised total: it
 * reads fine until somebody adds a fourth incident and the report quietly keeps
 * saying three.
 */
function report(now: number) {
  const rows = incidents(now);
  const open = rows.filter(isActive);
  const tally = (pick: (row: (typeof rows)[number]) => string | null) =>
    rows.reduce<Record<string, number>>((totals, row) => {
      const key = pick(row);
      if (key) totals[key] = (totals[key] ?? 0) + 1;
      return totals;
    }, {});

  const resolved = rows.filter((row) => row.resolvedAt != null);
  const mttrMinutes = resolved.length === 0 ? null : Math.round(
    resolved.reduce((total, row) => total + (Date.parse(row.resolvedAt!) - Date.parse(row.startedAt)), 0)
      / resolved.length / 60_000,
  );

  const monitorTotal = boards(now).reduce((total, board) => total + board.monitorCount, 0);
  const breached = boards(now).reduce((total, board) => total + board.breachedCount, 0);

  return {
    monitors: { total: monitorTotal, ok: monitorTotal - breached, breached, unknown: 0 },
    incidents: {
      total: rows.length,
      open: open.length,
      bySeverity: tally((row) => row.severity),
      bySystem: tally((row) => row.affectedSystem),
      bySource: tally((row) => row.source),
      mttrMinutes,
      recent: rows,
    },
  };
}

export const reliabilityFixtures: GuestFixture[] = [
  {
    id: 'reliability.incidents.list',
    match: exact('/api/incidents'),
    respond: ({ now, query }: GuestFixtureContext) => {
      const rows = incidents(now);
      return { incidents: query.get('activeOnly') === 'true' ? rows.filter(isActive) : rows };
    },
  },
  {
    id: 'reliability.oncall.rotations',
    match: exact('/api/incidents/on-call/rotations'),
    respond: () => ({ rotations: rotations() }),
  },
  {
    id: 'reliability.escalation.policies',
    match: exact('/api/incidents/escalation/policies'),
    respond: () => ({ policies: policies() }),
  },
  {
    id: 'reliability.contacts',
    match: exact('/api/incidents/contacts'),
    respond: () => ({ contacts: contacts() }),
  },
  {
    id: 'reliability.monitoring.boards',
    match: exact('/api/monitoring/boards'),
    respond: ({ now }: GuestFixtureContext) => ({ boards: boards(now) }),
  },
  {
    id: 'reliability.monitoring.report',
    match: exact('/api/monitoring/report'),
    respond: ({ now }: GuestFixtureContext) => report(now),
  },
];
