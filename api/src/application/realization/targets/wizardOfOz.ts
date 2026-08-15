/**
 * `wizard-of-oz` — deliver the outcome by hand, behind a front end that is real.
 *
 * The customer sees a product. Behind it a person does the work manually, on a
 * clock, against a promise. It is the only proof that tells you whether the
 * OUTCOME is worth paying for independently of whether you can automate it — and
 * it is the one most teams skip, because doing the work by hand feels like
 * cheating. It is not cheating; it is the fastest legitimate way to learn what
 * the automation would have to be good at.
 *
 * ── WHY THE ROUTES ARE THE ONES THE REAL SYSTEM WILL USE ────────────────────
 * The request form posts to the same collection, and the console reads through
 * the same handler, that a built system would. When the human is replaced by
 * code, the front end does not change and the customer never notices — which is
 * the point. A wizard-of-oz built on throwaway plumbing has to be rebuilt to be
 * automated, and then it was a prototype with extra steps.
 *
 * ── WHY THE CONSOLE HAS A CLOCK ─────────────────────────────────────────────
 * The failure mode of a concierge test is not "the human cannot do it", it is
 * "the human forgot". A queue with an SLA clock and an overdue state is the
 * difference between a test and a stack of unanswered requests.
 */

import { esc, renderProofShell, INGRESS_PRELUDE } from '../proofShell';
import { audienceOf, capabilityLabel, criteriaFrom, goalHeadline } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

const COLLECTION = 'requests';

/** The promise the operator is held to. Stated on the customer's page, measured
 *  in the console — one number in two places, so it cannot quietly drift. */
const SLA_MINUTES = 60;

function renderRequestPage(ctx: RealizeContext): string {
  const { spec } = ctx;
  const what = spec.capabilities.length ? capabilityLabel(spec.capabilities[0]!) : 'your request';

  const body = `  <section style="margin-top:0">
    <div class="card">
      <h2>Ask for ${esc(what.toLowerCase())}</h2>
      <p class="muted">Tell us what you need. You will have an answer within ${SLA_MINUTES} minutes.</p>
      <form id="request" novalidate>
        <div class="field">
          <label for="email">Where should we send it?</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@company.com" />
        </div>
        <div class="field">
          <label for="ask">What do you need?</label>
          <textarea id="ask" name="ask" rows="5" required placeholder="Be as specific as you like — the more detail, the better the answer."></textarea>
        </div>
        <div class="field">
          <label for="urgency">How soon?</label>
          <select id="urgency" name="urgency">
            <option value="today">Today</option>
            <option value="this-week">This week</option>
            <option value="no-rush">No rush</option>
          </select>
        </div>
        <div class="field" style="position:absolute;left:-9999px" aria-hidden="true">
          <label for="company_website">Leave this empty</label>
          <input id="company_website" name="company_website" tabindex="-1" autocomplete="off" />
        </div>
        <button type="submit" id="submit">Send it</button>
        <p class="muted" id="status" role="status" style="margin:12px 0 0;font-size:14px"></p>
      </form>
    </div>
  </section>

  <footer>${esc(spec.title)} — ${esc(goalHeadline(spec))}</footer>`;

  const script = `  var form = document.getElementById('request');
  var status = document.getElementById('status');
  var submit = document.getElementById('submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = document.getElementById('email').value.trim();
    var ask = document.getElementById('ask').value.trim();
    if (!email || email.indexOf('@') < 1 || !ask) {
      status.textContent = 'An address and a request, please.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending…';

    fetch('/__api/collections/${COLLECTION}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        ask: ask,
        urgency: document.getElementById('urgency').value,
        company_website: document.getElementById('company_website').value,
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error('rejected');
      form.innerHTML = '<h3>We have it</h3><p class="muted">You will hear back within ' +
        ${SLA_MINUTES} + ' minutes at ' + email + '.</p>';
    }).catch(function () {
      submit.disabled = false;
      status.textContent = 'That did not send. Try again in a moment.';
    });
  });`;

  return renderProofShell({
    title: spec.title,
    subtitle: goalHeadline(spec),
    body,
    script,
    maxWidth: 760,
  });
}

function renderOperatorConsole(ctx: RealizeContext): string {
  const body = `  <section style="margin-top:0" class="grid">
    <div class="card">
      <p class="label">Waiting</p>
      <div class="num" id="waiting">—</div>
      <div class="muted">requests in the queue</div>
    </div>
    <div class="card">
      <p class="label">Overdue</p>
      <div class="num" id="overdue">—</div>
      <div class="muted">past the ${SLA_MINUTES}-minute promise</div>
    </div>
    <div class="card">
      <p class="label">Oldest</p>
      <div class="num" id="oldest">—</div>
      <div class="muted">minutes waiting</div>
    </div>
  </section>

  <section>
    <h2>Queue</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>Waiting</th><th>Ask</th><th>Urgency</th><th>Reply to</th></tr></thead>
        <tbody id="queue"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
      </table>
    </div>
    <p class="muted" style="font-size:13px">
      Refreshes every 20 seconds. Answer from your own inbox — the customer must not be able to
      tell that a person is doing this, which is the whole test.
    </p>
  </section>

  <footer>${esc(ctx.spec.title)} — operator console. Keep this open while the test is running.</footer>`;

  const script = `${INGRESS_PRELUDE}
  var SLA_MS = ${SLA_MINUTES} * 60 * 1000;

  function minutesSince(iso) {
    var t = Date.parse(iso);
    return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : 0;
  }

  function render(data) {
    var records = data.records || [];
    var waiting = records.length;
    var ages = records.map(function (r) { return minutesSince(r.createdAt); });
    var overdue = ages.filter(function (m) { return m * 60000 > SLA_MS; }).length;

    document.getElementById('waiting').textContent = waiting;
    document.getElementById('overdue').textContent = overdue;
    document.getElementById('oldest').textContent = ages.length ? Math.max.apply(null, ages) : 0;

    document.getElementById('queue').innerHTML = records.length
      ? records.map(function (r, i) {
          var late = ages[i] * 60000 > SLA_MS;
          return '<tr><td><span class="pill ' + (late ? 'bad' : 'ok') + '">' + ages[i] + 'm</span></td>' +
            '<td>' + (r.ask || '').slice(0, 240) + '</td>' +
            '<td>' + (r.urgency || '—') + '</td>' +
            '<td class="mono">' + (r.email || '—') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="muted">Nothing waiting.</td></tr>';
  }

  function load() {
    if (!INGRESS) {
      document.getElementById('queue').innerHTML =
        '<tr><td colspan="4" class="muted">This console has no backend address yet — rebuild the proof.</td></tr>';
      return;
    }
    fetch(INGRESS + '/queue')
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        document.getElementById('queue').innerHTML =
          '<tr><td colspan="4" class="muted">Could not reach the backend.</td></tr>';
      });
  }

  load();
  setInterval(load, 20000);`;

  return renderProofShell({
    title: 'Operator console',
    subtitle: `Everything waiting, and how long it has waited against the ${SLA_MINUTES}-minute promise.`,
    eyebrow: 'Wizard of Oz',
    body,
    script,
  });
}

export const wizardOfOzTarget: RealizationTarget = {
  key: 'wizard-of-oz',
  name: 'Wizard of Oz',
  summary: 'A real front end with a human behind it, on an SLA clock, using the routes the built system will use.',
  answers: 'Is the outcome worth paying for, before we can automate it?',
  fidelity: 3,
  effort: 2,
  suits: ['ai-agent', 'chat', 'email', 'notifications', 'crm', 'search'],
  strategy: 'declarative',

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;

    return {
      summary: `A live request page and an operator queue with a ${SLA_MINUTES}-minute clock — the outcome delivered by hand.`,
      files: {
        'index.html': renderRequestPage(ctx),
        'console.html': renderOperatorConsole(ctx),
        'wizard-of-oz/runbook.md': `# ${spec.title} — operator runbook

The customer sees a product. You are the product. Everything below exists so that
stays true.

## The promise

Every request answered within **${SLA_MINUTES} minutes**, in the window you are
running. Put the window on the page if it is not 24/7 — a promise you break on
the first evening teaches you nothing except that you broke it.

## The loop

1. \`console.html\` is open. Refresh is automatic; do not rely on it — check it.
2. A request appears. Do the work. By hand. However long it takes.
3. Reply from a real address, as the product would.
4. Log it in the table below, immediately.

## What you are actually measuring

| Question | Where the answer comes from |
|---|---|
| Do people want the outcome? | Repeat requests from the same person |
| What is it worth? | Whether anyone asks the price, and whether they flinch |
| What must the automation be good at? | The step that took you longest, every time |
| Where does it break? | The request you could not fulfil |

## The log

| # | Ask | Minutes to answer | What took the longest | Would code have done it? |
|---|-----|-------------------|-----------------------|--------------------------|
| 1 |     |                   |                       |                          |
| 2 |     |                   |                       |                          |
| 3 |     |                   |                       |                          |

## The rule that makes it a test

Do not tell them. Not because it is a secret — you will tell them afterwards —
but because a customer who knows a person is doing it asks differently, forgives
more, and gives you a reading you cannot use.

## When to stop

At 10 fulfilled requests, or the first time you cannot fulfil one. Both are
results. Running it to 50 because it is working is running a service, not a test.
`,
      },
      handlers: {
        queue: {
          name: 'queue',
          route: '/queue',
          method: 'GET',
          // Public, and it carries requester email addresses — so the console
          // route is the one thing here that MUST move behind auth before this
          // is pointed at real customers. Said plainly in the seeded ticket
          // rather than left for someone to notice.
          verify: 'none',
          description: 'The operator queue: everything waiting, oldest first.',
          steps: [
            { kind: 'data', id: 'requests', collection: COLLECTION, limit: 50 },
          ],
          respond: {
            kind: 'json',
            body: {
              count: '{{steps.requests.count}}',
              records: '{{steps.requests.records}}',
            },
          },
        },
      },
      tasks: [
        {
          order: 10,
          title: 'Put the operator console behind a login before real customers arrive',
          description:
            'The /queue handler is public and its reply contains requester email addresses — deliberate, so the console works with zero setup while you are testing with people you know. Before this is pointed at strangers, either move console.html off the public site or change the handler to verify a shared secret.',
          kind: 'build',
        },
        {
          order: 20,
          title: `Commit to the ${SLA_MINUTES}-minute promise and the hours you will keep it`,
          description:
            'Decide the window, put it on the request page, and staff it. An SLA broken on the first evening tells you nothing about demand and quite a lot about the test.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Wire an alert so a request cannot sit unseen',
          description:
            'The console refreshes, but nobody watches a console all day. Send yourself a message when a request lands — email, SMS, a chat webhook, whatever you already look at. Add a connector step to the queue handler or poll it from a tool you already run.',
          kind: 'build',
        },
        {
          order: 40,
          title: 'Fulfil ten requests by hand and log every one',
          description:
            'Fill in wizard-of-oz/runbook.md as you go, not afterwards. The column that matters is "what took the longest" — that is the specification for the automation.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [COLLECTION],
      successCriteria: criteriaFrom(spec, [
        `Ten requests from ${audienceOf(spec)} fulfilled by a human inside the ${SLA_MINUTES}-minute promise.`,
        'No customer worked out that a person was doing it.',
        'The longest manual step is written down — that is what the automation has to be good at.',
      ]),
    };
  },
};
