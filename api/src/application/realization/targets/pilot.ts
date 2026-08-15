/**
 * `pilot` — run it with real people, at a size you can survive being wrong at.
 *
 * The proof between "it works in a demo" and "it is a product". A pilot is
 * bounded on three axes and it is a pilot only if all three are written down:
 * WHO is in it, HOW LONG it runs, and WHAT would make you stop. A pilot with no
 * end date is a product with no revenue, and a pilot with no exit criteria never
 * produces a decision — it produces a set of users you now cannot turn off.
 *
 * ── WHY THE DASHBOARD SHOWS ELAPSED TIME AS PROMINENTLY AS THE METRIC ───────
 * Pilots do not fail by missing their number; they fail by not ending. Putting
 * the clock next to the metric makes "we are in week nine of a four-week pilot"
 * something you see rather than something you realise.
 */

import { esc, renderProofShell, INGRESS_PRELUDE } from '../proofShell';
import { audienceOf, criteriaFrom, goalHeadline } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

const COLLECTION = 'pilot-feedback';

/** Defaults, stated so they can be argued with rather than inherited silently. */
const COHORT = 10;
const WEEKS = 4;

function renderDashboard(ctx: RealizeContext): string {
  const { spec } = ctx;

  const body = `  <section style="margin-top:0" class="grid">
    <div class="card">
      <p class="label">Week</p>
      <div class="num" id="week">—</div>
      <div class="muted">of ${WEEKS}</div>
      <div class="bar"><i id="week-bar" style="width:0%"></i></div>
    </div>
    <div class="card">
      <p class="label">Feedback received</p>
      <div class="num" id="responses">—</div>
      <div class="muted">from a cohort of ${COHORT}</div>
    </div>
    <div class="card">
      <p class="label">Would be annoyed if it went away</p>
      <div class="num" id="pmf">—</div>
      <div class="muted">the only question that predicts anything</div>
      <div class="bar"><i id="pmf-bar" style="width:0%"></i></div>
    </div>
  </section>

  <section>
    <div class="card">
      <h2>Tell us how it went</h2>
      <p class="muted" style="margin-top:0">Two minutes. Every week, even the weeks nothing happened.</p>
      <form id="feedback" novalidate>
        <div class="field">
          <label for="who">Who are you?</label>
          <input id="who" name="who" placeholder="Name or email" required />
        </div>
        <div class="field">
          <label for="used">Did you use it this week?</label>
          <select id="used" name="used">
            <option value="daily">Most days</option>
            <option value="weekly">Once or twice</option>
            <option value="no">Not at all</option>
          </select>
        </div>
        <div class="field">
          <label for="disappointed">How would you feel if it went away tomorrow?</label>
          <select id="disappointed" name="disappointed">
            <option value="very">Very disappointed</option>
            <option value="somewhat">Somewhat disappointed</option>
            <option value="not">Not disappointed</option>
          </select>
        </div>
        <div class="field">
          <label for="friction">What got in the way?</label>
          <textarea id="friction" name="friction" rows="3" placeholder="The thing that made you stop, or nearly stop."></textarea>
        </div>
        <div class="field" style="position:absolute;left:-9999px" aria-hidden="true">
          <label for="company_website">Leave this empty</label>
          <input id="company_website" name="company_website" tabindex="-1" autocomplete="off" />
        </div>
        <button type="submit" id="submit">Send</button>
        <p class="muted" id="status" role="status" style="margin:12px 0 0;font-size:14px"></p>
      </form>
    </div>
  </section>

  <section>
    <h2>What the cohort said</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>When</th><th>Used it</th><th>If it went away</th><th>What got in the way</th></tr></thead>
        <tbody id="rows"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>

  <footer>${esc(spec.title)} — pilot dashboard. Exit criteria are in <code>pilot/charter.md</code>.</footer>`;

  const script = `${INGRESS_PRELUDE}
  var COHORT = ${COHORT};
  var WEEKS = ${WEEKS};
  var STARTED_KEY = 'bf.pilot.started';

  // The clock starts the first time anyone opens the dashboard, so a pilot that
  // was set up and never launched does not silently report week 4.
  var started = Number(localStorage.getItem(STARTED_KEY) || 0);
  if (!started) { started = Date.now(); localStorage.setItem(STARTED_KEY, String(started)); }
  var week = Math.min(WEEKS, Math.floor((Date.now() - started) / (7 * 86400000)) + 1);
  document.getElementById('week').textContent = week;
  document.getElementById('week-bar').style.width = Math.round((week / WEEKS) * 100) + '%';

  function render(data) {
    var records = data.records || [];
    document.getElementById('responses').textContent = records.length;

    var answered = records.filter(function (r) { return r.disappointed; });
    var very = answered.filter(function (r) { return r.disappointed === 'very'; }).length;
    var pct = answered.length ? Math.round((very / answered.length) * 100) : 0;
    document.getElementById('pmf').textContent = answered.length ? pct + '%' : '—';
    document.getElementById('pmf-bar').style.width = pct + '%';

    document.getElementById('rows').innerHTML = records.length
      ? records.map(function (r) {
          return '<tr><td>' + (r.createdAt || '').slice(0, 10) + '</td><td>' + (r.used || '—') +
            '</td><td>' + (r.disappointed || '—') + '</td><td>' + ((r.friction || '').slice(0, 200) || '—') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="muted">No feedback yet.</td></tr>';
  }

  function load() {
    if (!INGRESS) {
      document.getElementById('rows').innerHTML =
        '<tr><td colspan="4" class="muted">This dashboard has no backend address yet — rebuild the proof.</td></tr>';
      return;
    }
    fetch(INGRESS + '/pilot-report')
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        document.getElementById('rows').innerHTML =
          '<tr><td colspan="4" class="muted">Could not reach the backend.</td></tr>';
      });
  }

  document.getElementById('feedback').addEventListener('submit', function (event) {
    event.preventDefault();
    var status = document.getElementById('status');
    var submit = document.getElementById('submit');
    submit.disabled = true;
    status.textContent = 'Sending…';

    fetch('/__api/collections/${COLLECTION}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        who: document.getElementById('who').value.trim(),
        used: document.getElementById('used').value,
        disappointed: document.getElementById('disappointed').value,
        friction: document.getElementById('friction').value.trim(),
        week: week,
        company_website: document.getElementById('company_website').value,
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error('rejected');
      status.textContent = 'Thank you — see you next week.';
      document.getElementById('feedback').reset();
      load();
    }).catch(function () {
      status.textContent = 'That did not send. Try again in a moment.';
    }).then(function () { submit.disabled = false; });
  });

  load();
  void COHORT;`;

  return renderProofShell({
    title: `${spec.title} — pilot`,
    subtitle: `${COHORT} people, ${WEEKS} weeks, one question that decides it.`,
    eyebrow: 'Pilot',
    body,
    script,
  });
}

export const pilotTarget: RealizationTarget = {
  key: 'pilot',
  name: 'Pilot',
  summary: 'A bounded run with a named cohort, a weekly feedback loop and written exit criteria.',
  answers: 'Does it hold up with real people, at a size we can survive being wrong at?',
  fidelity: 4,
  effort: 4,
  suits: ['dashboard', 'analytics', 'notifications', 'crm', 'scheduling'],
  strategy: 'declarative',

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;

    return {
      summary: `A ${WEEKS}-week pilot dashboard for a cohort of ${COHORT}, with a weekly feedback loop and an exit rule.`,
      files: {
        'pilot/index.html': renderDashboard(ctx),
        'pilot/charter.md': `# ${spec.title} — pilot charter

A pilot is bounded on three axes. If any one of them is blank, this is not a
pilot — it is a soft launch, and soft launches do not end.

## Who

**${COHORT} people**, named, from ${audienceOf(spec)}.

| # | Name | Why them | Committed? |
|---|------|----------|------------|
| 1 |      |          |            |
| 2 |      |          |            |
| 3 |      |          |            |

Named individuals, not "some customers". A cohort you cannot list is a cohort
you cannot chase for feedback, and unchased feedback does not arrive.

## How long

**${WEEKS} weeks** from first use. Put the end date here, now: ______________

## What we are measuring

${goalHeadline(spec)}

The headline question is the one on the feedback form: *how would you feel if it
went away tomorrow?* It predicts retention better than satisfaction does, because
satisfaction is politeness and disappointment is dependence.

| | Target |
|---|---|
| "Very disappointed" | **40%** or more of respondents |
| Weekly feedback | **${Math.ceil(COHORT * 0.6)} of ${COHORT}** every week |
| Used it most days | **half** the cohort by week ${WEEKS} |

## What stops it

Write these down before week one. The point of an exit criterion is that it
fires when you least want it to:

- **Stop if** fewer than ${Math.ceil(COHORT * 0.3)} people use it at all in week 2.
- **Stop if** the same blocking problem appears in three consecutive weeks unfixed.
- **Stop if** anything in it puts customer data somewhere it should not be.

## The weekly readout

Fifteen minutes, same time each week, whoever is around:

1. The dashboard number.
2. The one thing that got in the way most.
3. What changes before next week — one thing, not five.

Skipping a readout because "nothing much happened" is how a pilot becomes four
weeks of nothing much happening.

## The decision

At the end date, one of three, written down and dated:

- **Ship it** — the numbers cleared and you know what to build next.
- **Extend once** — with a stated reason and a new end date. Once.
- **Stop** — with the reason. A stopped pilot with a written reason is worth more
  than a running one nobody is looking at.
`,
      },
      handlers: {
        'pilot-report': {
          name: 'pilot-report',
          route: '/pilot-report',
          method: 'GET',
          verify: 'none',
          description: 'Cohort feedback for the pilot dashboard.',
          steps: [
            { kind: 'data', id: 'feedback', collection: COLLECTION, limit: 100 },
          ],
          respond: {
            kind: 'json',
            body: {
              count: '{{steps.feedback.count}}',
              records: '{{steps.feedback.records}}',
            },
          },
        },
      },
      tasks: [
        {
          order: 10,
          title: `Name the ${COHORT} people and get each of them to say yes`,
          description:
            'Fill in the table in pilot/charter.md with actual names. A cohort described as "some customers" cannot be chased for feedback, and feedback that is not chased does not arrive.',
          kind: 'setup',
        },
        {
          order: 20,
          title: 'Set the end date and the three stop conditions',
          description:
            'Both are in pilot/charter.md and both are blank on purpose. An exit criterion written after week two is written by someone who already knows what they want it to say.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Book the weekly readout in the calendar for all four weeks',
          description:
            'Fifteen minutes, same time, booked now. A readout that gets scheduled week by week is a readout that gets skipped in week three, which is the week the interesting thing happens.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Make the pilot dashboard reachable only by the cohort',
          description:
            'The dashboard and its /pilot-report handler are public so the pilot can start with zero setup. Before real customer feedback is in it, put the page behind a link only the cohort has, or verify a shared secret on the handler.',
          kind: 'build',
        },
        {
          order: 50,
          title: 'Write the decision on the end date',
          description:
            'Ship, extend once with a reason, or stop with a reason. All three are results. The only failure is a pilot that is still running because nobody wrote anything down.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [COLLECTION],
      successCriteria: criteriaFrom(spec, [
        `${COHORT} named participants ran it for ${WEEKS} weeks.`,
        'At least 40% of respondents would be very disappointed if it went away.',
        'A ship / extend / stop decision is written down and dated on the end date.',
      ]),
    };
  },
};
