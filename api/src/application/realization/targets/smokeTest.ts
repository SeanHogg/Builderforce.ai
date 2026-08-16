/**
 * `smoke-test` — find out whether anyone wants it, before building it.
 *
 * A landing page that describes the product as though it exists, a way to say
 * "yes I want this", and a number that decides. The page is a fake door: nothing
 * behind it is real, and the page says so the moment someone signs up, because a
 * test that leaves people believing they bought something is not a test, it is a
 * lie with a form on it.
 *
 * ── WHY THE KILL NUMBER IS GENERATED INTO THE PAGE ──────────────────────────
 * The single thing that separates a smoke test from a landing page is a
 * threshold written down BEFORE the traffic arrives. Without it, whatever number
 * comes back is interpreted as encouraging — 3 signups is "early signal", 300 is
 * "we should have charged". So the charter file states the target, the sample and
 * the decision, and the demand console shows progress against that target rather
 * than a bare count.
 *
 * ── WHY THE FORM POSTS SAME-ORIGIN ──────────────────────────────────────────
 * `/__api/collections/<name>` is the project site's own write endpoint, so the
 * page needs no CORS entry, no key in the markup and no handler. The read side
 * is a handler, because that endpoint is deliberately write-only: a signup list
 * anyone can enumerate is a leak, and this one is full of email addresses.
 */

import { esc, renderProofShell, INGRESS_PRELUDE } from '../proofShell';
import { audienceOf, capabilityLabel, criteriaFrom, goalHeadline, verdictRecorderScript, VERDICT_COLLECTION } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

const COLLECTION = 'waitlist';

/** Default threshold when the brief named none. Stated, never silently assumed. */
const DEFAULT_TARGET = 25;
const DEFAULT_SAMPLE = 500;

function renderLanding(ctx: RealizeContext): string {
  const { spec } = ctx;
  const benefits = (spec.capabilities.length ? spec.capabilities.slice(0, 3) : ['It does the thing you keep doing by hand'])
    .map(capabilityLabel);

  const body = `  <section style="margin-top:0">
    <div class="grid">
${benefits.map((benefit) => `      <div class="card">
        <h3>${esc(benefit)}</h3>
        <p class="muted" style="margin:0;font-size:14px">Replace this with the outcome, not the feature. What does ${esc(audienceOf(spec))} get?</p>
      </div>`).join('\n')}
    </div>
  </section>

  <section>
    <div class="card" id="signup-card">
      <h2>Get early access</h2>
      <p class="muted">We are building this now. Leave an address and we will show you first.</p>
      <form id="signup" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@company.com" />
        </div>
        <div class="field">
          <label for="context">What are you doing about this today?</label>
          <textarea id="context" name="context" rows="3" placeholder="However you handle it now — that answer is worth more than the signup."></textarea>
        </div>
        <div class="field" style="position:absolute;left:-9999px" aria-hidden="true">
          <label for="company_website">Leave this empty</label>
          <input id="company_website" name="company_website" tabindex="-1" autocomplete="off" />
        </div>
        <button type="submit" id="submit">Request access</button>
        <p class="muted" id="status" role="status" style="margin:12px 0 0;font-size:14px"></p>
      </form>
    </div>
  </section>

  <footer>
    This page is a demand test. Nothing behind it is built yet — that is exactly what it is
    measuring, and anyone who signs up is told so immediately.
  </footer>`;

  const script = `  var form = document.getElementById('signup');
  var status = document.getElementById('status');
  var submit = document.getElementById('submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = document.getElementById('email').value.trim();
    if (!email || email.indexOf('@') < 1) {
      status.textContent = 'That does not look like an email address.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending…';

    // Same-origin: this is the site's own write endpoint, so there is no key in
    // the page and no CORS entry to maintain.
    fetch('/__api/collections/${COLLECTION}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        context: document.getElementById('context').value.trim(),
        company_website: document.getElementById('company_website').value,
        referrer: document.referrer || '',
        source: new URLSearchParams(location.search).get('src') || 'direct',
      }),
    }).then(function (res) {
      if (!res.ok) throw new Error('rejected');
      // Told the truth, immediately. A fake door that leaves someone believing
      // they have bought something is not a test.
      document.getElementById('signup-card').innerHTML =
        '<h2>You are on the list</h2>' +
        '<p>Honest answer: this is not built yet. You just told us it is worth building, ' +
        'which is the whole reason this page exists. We will come back to you before anyone else.</p>';
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
    maxWidth: 820,
  });
}

function renderDemandConsole(ctx: RealizeContext, target: number, sample: number): string {
  const body = `  <section style="margin-top:0" class="grid">
    <div class="card">
      <p class="label">Signups</p>
      <div class="num" id="count">—</div>
      <div class="muted" id="count-note">of ${target} needed</div>
      <div class="bar"><i id="count-bar" style="width:0%"></i></div>
    </div>
    <div class="card">
      <p class="label">Verdict</p>
      <div id="verdict" style="margin-top:8px"><span class="pill">waiting for traffic</span></div>
      <p class="muted" style="font-size:13px;margin:12px 0 0">
        Decided against the threshold written in <code>smoke-test/charter.md</code>, not against how it feels.
      </p>
      <button type="button" id="record-verdict" style="display:none;margin-top:12px"></button>
      <p class="muted" style="font-size:12px;margin:8px 0 0">
        Recording writes today's count to this proof's record, permanently. Do it once you are ready to call it —
        not the moment the number first looks good.
      </p>
    </div>
    <div class="card">
      <p class="label">Sample needed</p>
      <div class="num">${sample}</div>
      <div class="muted">visitors before this number means anything</div>
    </div>
  </section>

  <section>
    <h2>Who asked</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>When</th><th>Where from</th><th>What they do today</th></tr></thead>
        <tbody id="rows"><tr><td colspan="3" class="muted">Loading…</td></tr></tbody>
      </table>
    </div>
    <p class="muted" style="font-size:13px">
      Email addresses are deliberately not shown here — this page is on a public site.
      Read the full list from the project's Site → Collections panel.
    </p>
  </section>`;

  const script = `${INGRESS_PRELUDE}
${verdictRecorderScript()}
  var TARGET = ${target};
  var SAMPLE = ${sample};

  function verdict(count) {
    if (count >= TARGET) return ['ok', 'threshold met — build it'];
    if (count >= TARGET / 2) return ['warn', 'halfway — keep the traffic running'];
    return ['bad', 'below threshold'];
  }

  function render(data) {
    var records = data.records || [];
    var count = typeof data.count === 'number' ? data.count : records.length;
    document.getElementById('count').textContent = count;
    document.getElementById('count-bar').style.width = Math.min(100, (count / TARGET) * 100) + '%';

    var v = verdict(count);
    document.getElementById('verdict').innerHTML = '<span class="pill ' + v[0] + '">' + v[1] + '</span>';

    var recordBtn = document.getElementById('record-verdict');
    if (count > 0) {
      var decided = count >= TARGET ? 'met' : 'missed';
      recordBtn.style.display = '';
      recordBtn.disabled = false;
      recordBtn.textContent = 'Record verdict — ' + decided;
      recordBtn.onclick = function () {
        recordVerdict('record-verdict', decided, 'Signups', count, TARGET, { sample: SAMPLE });
      };
    }

    document.getElementById('rows').innerHTML = records.length
      ? records.map(function (r) {
          return '<tr><td>' + (r.createdAt || '').slice(0, 16).replace('T', ' ') + '</td><td>' +
            (r.source || 'direct') + '</td><td>' + ((r.context || '').slice(0, 160) || '—') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="3" class="muted">No signups yet.</td></tr>';
  }

  function load() {
    if (!INGRESS) {
      document.getElementById('rows').innerHTML =
        '<tr><td colspan="3" class="muted">This page has no backend address yet — rebuild the proof.</td></tr>';
      return;
    }
    fetch(INGRESS + '/demand')
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        document.getElementById('rows').innerHTML =
          '<tr><td colspan="3" class="muted">Could not reach the backend.</td></tr>';
      });
  }

  load();
  // A demand console is left open on a second monitor during a launch; a stale
  // number on it is worse than no console.
  setInterval(load, 30000);`;

  return renderProofShell({
    title: 'Demand',
    subtitle: 'What the fake door actually measured, against the threshold set before it opened.',
    eyebrow: 'Smoke test',
    body,
    script,
  });
}

export const smokeTestTarget: RealizationTarget = {
  key: 'smoke-test',
  name: 'Smoke test',
  summary: 'A fake-door landing page, a waitlist, and a demand console judged against a pre-set threshold.',
  answers: 'Does anyone actually want this?',
  fidelity: 2,
  effort: 2,
  suits: ['analytics', 'dashboard', 'email', 'notifications'],
  strategy: 'declarative',

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;
    const target = DEFAULT_TARGET;
    const sample = DEFAULT_SAMPLE;

    return {
      summary: `A live landing page with a waitlist, and a demand console that says build or stop at ${target} signups.`,
      files: {
        'index.html': renderLanding(ctx),
        'demand.html': renderDemandConsole(ctx, target, sample),
        'smoke-test/charter.md': `# ${spec.title} — smoke test charter

Written **before** the traffic arrives. That order is the entire method: a
threshold chosen after the results are in is not a threshold, it is a
rationalisation.

## The claim under test

${goalHeadline(spec)}

## The threshold

| | |
|---|---|
| Signups needed | **${target}** |
| Out of at least | **${sample}** unique visitors |
| Window | **14 days** from first traffic |

## The decision

- **At or above ${target}** — build the next proof up (a wizard-of-oz or a pilot). Do not
  jump straight to the full system; demand for a promise is not demand for your
  implementation of it.
- **Between ${Math.round(target / 2)} and ${target}** — the offer is close but the page is probably
  wrong before the idea is. Change ONE thing (the headline, the audience, the
  price) and run it again. Changing three tells you nothing.
- **Below ${Math.round(target / 2)}** — park it, and write down what you learned. A parked idea
  with evidence is a result. A quietly abandoned one is a tax on the next idea.

## Traffic

Name the source before you start, because "we'll post it around" produces a
sample that cannot be read:

- [ ] Source: ______________________
- [ ] Budget or effort: ______________________
- [ ] Expected visitors: ______________________

## Honesty

Everyone who signs up is told immediately that this is not built yet. That is
non-negotiable — the interest you are measuring has to be interest in the thing,
not in a purchase somebody thinks they made.
`,
      },
      handlers: {
        demand: {
          name: 'demand',
          route: '/demand',
          method: 'GET',
          // Public: the console is on the public site and this is what feeds it.
          // The reply carries no email addresses for exactly that reason.
          verify: 'none',
          description: 'Waitlist volume and context for the demand console. Deliberately excludes email addresses.',
          steps: [
            { kind: 'data', id: 'signups', collection: COLLECTION, limit: 100 },
          ],
          respond: {
            kind: 'json',
            body: {
              count: '{{steps.signups.count}}',
              records: '{{steps.signups.records}}',
            },
          },
        },
      },
      tasks: [
        {
          order: 10,
          title: 'Rewrite the landing page in the customer\'s words',
          description:
            'The three cards currently name capabilities. Replace each with the outcome someone would pay for, in the words they would use — the page is measuring whether the OFFER lands, and a feature list measures nothing.',
          kind: 'build',
        },
        {
          order: 20,
          title: `Confirm or change the threshold: ${target} signups from ${sample} visitors`,
          description:
            'Open smoke-test/charter.md and either agree the numbers or replace them. Do this before any traffic arrives. A threshold set afterwards is a story about the result.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Name the traffic source and start it',
          description:
            'One named source with an expected volume. "We will share it around" produces a sample nobody can interpret and a result nobody will act on.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Call it on day 14',
          description:
            'Open demand.html and click "Record verdict" — it writes the current count and the call it decides straight to this proof\'s record, so the decision survives a refresh. A smoke test with no decision at the end is just a page that existed for two weeks.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [COLLECTION, VERDICT_COLLECTION],
      successCriteria: criteriaFrom(spec, [
        `At least ${sample} visitors reached the landing page from a named source.`,
        `The signup count is recorded against the ${target} threshold, and a build-or-park decision is written down.`,
        'Every person who signed up was told, at the moment of signing up, that it is not built yet.',
      ]),
    };
  },
};
