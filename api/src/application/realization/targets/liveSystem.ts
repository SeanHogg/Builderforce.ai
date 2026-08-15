/**
 * `live-system` — the thing itself, running, at an address someone can use.
 *
 * The most expensive proof, and the only one that is not a stand-in. It is last
 * in the registry for a reason: every other target exists to make sure this one
 * is built for something that was wanted, worked, and could be operated.
 *
 * ── WHY THIS ONE EXTENDS THE BRIEF'S PLAN ───────────────────────────────────
 * The other targets replace the plan with a proof. This one IS the plan — the
 * blueprint's handlers, connectors and secrets — plus the things a system needs
 * that a build does not produce: somewhere to run, a page that shows whether it
 * is running, and a written answer to "what do we do when it breaks at 3am".
 * `extendsBriefPlan` is what stops it discarding the work the challenge pipeline
 * already did.
 *
 * ── WHY IT CAN BE DEPLOYED SOMEWHERE ELSE ───────────────────────────────────
 * `allowsStrategyChoice`. The zero-setup platform ingress is right for every
 * proof up to this point, and wrong for a system that has to satisfy a data
 * residency clause, an existing enterprise agreement, or a security review that
 * only knows how to audit one provider. The hosting port already has adapters
 * for AWS, Google Cloud and Azure; this is the target that lets someone pick one.
 */

import { renderOpsConsole } from '../../challenge/blueprints/opsConsole';
import { criteriaFrom, goalHeadline } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

export const liveSystemTarget: RealizationTarget = {
  key: 'live-system',
  name: 'Live system',
  summary: 'The whole system running at a real address, with an ops console and an on-call runbook.',
  answers: 'Is it actually running, and can we operate it?',
  fidelity: 5,
  effort: 5,
  suits: [],
  strategy: 'declarative',
  extendsBriefPlan: true,
  allowsStrategyChoice: true,

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;

    return {
      summary: 'The planned system, live, with an operations console and a runbook for the first incident.',
      files: {
        'ops.html': renderOpsConsole({
          title: `${spec.title} — operations`,
          subtitle: 'Every endpoint, whether it is serving, and what has reached it. Open this before opening the logs.',
          targetLabel: 'Public address',
          routes: [{ label: 'System root', path: '/' }],
          meters: [{ label: 'Requests this month', allowance: 100000 }],
        }),
        'ops/runbook.md': `# ${spec.title} — runbook

${goalHeadline(spec)}

Written now, while nothing is on fire. A runbook written during an incident is a
transcript of an incident.

## Where it runs

| | |
|---|---|
| Backend | see the project's Backend panel |
| Public address | \`ops.html\` shows it, live |
| Site | the project's published subdomain |

If the backend is deployed into your own cloud, the address in \`ops.html\` is
your deployment's, not the platform ingress — that swap is the whole point of the
self-hosted strategies, and pointing a provider at the wrong one of the two is
the most common way a working system appears broken.

## First five minutes of an incident

1. **Open \`ops.html\`.** Any endpoint showing "no handler" is a spec that failed
   to parse — the cause is in the project's Backend panel, not in the logs.
2. **Check the secrets.** A missing verification secret makes every request 403,
   and 403 from a provider looks exactly like an outage.
3. **Check the connections.** A revoked connector credential fails closed. The
   handler still answers; it just does nothing useful.
4. **Read the request log** in the Backend panel: route, verdict, status. The
   verdict column separates "we rejected it" from "we could not do it".
5. **Only then** open the provider's own console.

## The kill switch

The project's backend can be paused, which makes every ingress request 404
immediately. Use it. A misbehaving endpoint that is spending money or sending
messages should be stopped first and diagnosed second — every minute spent
diagnosing a live one is a minute it is still doing the thing.

## What must be true before real customers

- [ ] Every handler that spends money or sends a message verifies a signature.
- [ ] Every secret the handlers need is stored, and \`ops.html\` shows the routes live.
- [ ] Someone other than the author has run the whole flow end to end.
- [ ] There is a written answer to "how do we know it stopped working?" that is
      not "a customer tells us".
- [ ] The data this holds has a stated retention period and somewhere it is
      written down.

## Who is on call

| | |
|---|---|
| Primary | |
| Backup | |
| Hours | |
| How they are reached | |

An empty table here is the honest state of most first launches. Fill it in
anyway — the value is in noticing it is empty before the first incident rather
than during it.
`,
      },
      handlers: {},
      tasks: [
        {
          order: 10,
          title: 'Run the whole flow end to end, with someone who did not build it',
          description:
            'Not the happy path in isolation — the whole thing, start to finish, by a person who has not seen it before. Every system that "works" fails this the first time, and the failure is always in a step the author had stopped seeing.',
          kind: 'setup',
        },
        {
          order: 20,
          title: 'Answer "how do we know it stopped working?"',
          description:
            'Write the answer in ops/runbook.md. If the honest answer is "a customer tells us", say so — a known gap is manageable and an assumed monitor is not.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Fill in the on-call table',
          description:
            'Primary, backup, hours, and how they are reached. Ten minutes now, and it is the difference between an incident and an outage.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Confirm the address in ops.html is the one your providers point at',
          description:
            'A self-hosted backend answers on your own deployment, not the platform ingress. Pointing a webhook at the wrong one of the two is the single most common way a correctly built system looks broken from the provider\'s side.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [],
      successCriteria: criteriaFrom(spec, [
        'Every endpoint in ops.html reports live.',
        'A person who did not build it completed the whole flow end to end.',
        'The runbook has a named on-call and a written answer to "how do we know it stopped working?".',
      ]),
    };
  },
};
