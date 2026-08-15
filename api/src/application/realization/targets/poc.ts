/**
 * `poc` — prove the part that might not work.
 *
 * A proof of concept is not a small version of the product. It is one question,
 * isolated, with a threshold agreed in advance and a run count large enough that
 * the answer is not an anecdote. Most things called a POC are demos of the easy
 * parts, which is why so many of them succeed and are never heard from again.
 *
 * ── WHY THE HARNESS RUNS TRIALS AND NOT ONE REQUEST ─────────────────────────
 * The risky step in almost every modern system is non-deterministic — a model
 * call, a third-party match, an extraction. One successful run of a
 * non-deterministic step is not evidence of anything, and a demo built on one is
 * how a team commits to something that works four times in five. So the harness
 * runs a batch, records each verdict, and reports a rate against the threshold.
 *
 * ── WHY THE THRESHOLD IS PRE-REGISTERED IN A FILE ───────────────────────────
 * Same reason the smoke test's is: a bar chosen after the results are in is a
 * story about the results. `poc/hypothesis.md` is written at build time and the
 * harness shows the number next to it.
 */

import { esc, renderProofShell, INGRESS_PRELUDE } from '../proofShell';
import { criteriaFrom, goalHeadline, headlineCapabilities } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

/** Trials a run performs. Small enough to sit through, large enough that one
 *  lucky answer cannot carry it. */
const TRIALS = 20;
/** Default bar. Restated in the hypothesis file so it is arguable, not implied. */
const DEFAULT_PASS_RATE = 0.9;

function renderHarness(ctx: RealizeContext): string {
  const { spec } = ctx;
  const riskiest = headlineCapabilities(spec, 1)[0]!;

  const body = `  <section style="margin-top:0" class="grid">
    <div class="card">
      <p class="label">Pass rate</p>
      <div class="num" id="rate">—</div>
      <div class="muted">threshold ${Math.round(DEFAULT_PASS_RATE * 100)}%</div>
      <div class="bar"><i id="rate-bar" style="width:0%"></i></div>
    </div>
    <div class="card">
      <p class="label">Verdict</p>
      <div id="verdict" style="margin-top:8px"><span class="pill">no trials yet</span></div>
      <p class="muted" style="font-size:13px;margin:12px 0 0">
        Against the bar in <code>poc/hypothesis.md</code>, set before the first run.
      </p>
    </div>
    <div class="card">
      <p class="label">Trials</p>
      <div class="num" id="done">0</div>
      <div class="muted">of ${TRIALS}</div>
    </div>
  </section>

  <section>
    <div class="card">
      <h2>The risky step</h2>
      <p class="muted" style="margin-top:0">${esc(riskiest)} — isolated from everything that already works.</p>
      <div class="field">
        <label for="input">One input per line. Paste ${TRIALS} real examples, not made-up ones.</label>
        <textarea id="input" rows="8" placeholder="A real case&#10;Another real case&#10;A case you expect it to fail on"></textarea>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <button type="button" id="run">Run the trials</button>
        <button type="button" class="ghost" id="reset">Reset</button>
      </div>
      <p class="muted" style="font-size:13px;margin-top:12px">
        Mark each result pass or fail yourself. An automated grader is a second thing that
        might be wrong, and this run is meant to establish the first.
      </p>
    </div>
  </section>

  <section>
    <h2>Trials</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>#</th><th>Input</th><th>Output</th><th>Verdict</th></tr></thead>
        <tbody id="trials"><tr><td colspan="4" class="muted">Nothing run yet.</td></tr></tbody>
      </table>
    </div>
  </section>

  <footer>${esc(spec.title)} — ${esc(goalHeadline(spec))}</footer>`;

  const script = `${INGRESS_PRELUDE}
  var THRESHOLD = ${DEFAULT_PASS_RATE};
  var results = [];

  function paint() {
    var judged = results.filter(function (r) { return r.verdict !== null; });
    var passed = judged.filter(function (r) { return r.verdict === true; }).length;
    var rate = judged.length ? passed / judged.length : 0;

    document.getElementById('done').textContent = results.length;
    document.getElementById('rate').textContent = judged.length ? Math.round(rate * 100) + '%' : '—';
    document.getElementById('rate-bar').style.width = Math.round(rate * 100) + '%';

    var el = document.getElementById('verdict');
    if (judged.length < ${TRIALS}) {
      el.innerHTML = '<span class="pill">' + judged.length + ' of ${TRIALS} judged</span>';
    } else if (rate >= THRESHOLD) {
      el.innerHTML = '<span class="pill ok">clears the bar — build it</span>';
    } else {
      el.innerHTML = '<span class="pill bad">below the bar — this is the finding</span>';
    }

    document.getElementById('trials').innerHTML = results.length
      ? results.map(function (r, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(r.input) + '</td><td>' +
            escapeHtml(r.output || '—') + '</td><td>' +
            '<button type="button" class="ghost" data-pass="' + i + '" style="padding:4px 10px">pass</button> ' +
            '<button type="button" class="ghost" data-fail="' + i + '" style="padding:4px 10px">fail</button> ' +
            (r.verdict === true ? '<span class="pill ok">pass</span>' : r.verdict === false ? '<span class="pill bad">fail</span>' : '') +
            '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="muted">Nothing run yet.</td></tr>';

    document.querySelectorAll('[data-pass]').forEach(function (b) {
      b.addEventListener('click', function () { results[Number(b.getAttribute('data-pass'))].verdict = true; paint(); });
    });
    document.querySelectorAll('[data-fail]').forEach(function (b) {
      b.addEventListener('click', function () { results[Number(b.getAttribute('data-fail'))].verdict = false; paint(); });
    });
  }

  function escapeHtml(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  document.getElementById('run').addEventListener('click', function () {
    var inputs = document.getElementById('input').value.split('\\n')
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, ${TRIALS});
    if (!inputs.length) return;
    if (!INGRESS) {
      alert('This harness has no backend address yet — rebuild the proof.');
      return;
    }

    results = inputs.map(function (input) { return { input: input, output: '', verdict: null }; });
    paint();

    // Sequential, deliberately: a burst of parallel model calls is the fastest
    // way to spend a budget and hit a rate limit halfway through a run, which
    // makes the failures look like the step rather than the harness.
    var i = 0;
    (function next() {
      if (i >= results.length) return;
      var current = results[i];
      fetch(INGRESS + '/poc/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: current.input }),
      }).then(function (r) { return r.json(); })
        .then(function (data) { current.output = data.output || ''; })
        .catch(function () { current.output = '(request failed)'; })
        .then(function () { i++; paint(); next(); });
    })();
  });

  document.getElementById('reset').addEventListener('click', function () { results = []; paint(); });

  paint();`;

  return renderProofShell({
    title: 'Feasibility harness',
    subtitle: `${TRIALS} trials of the one step that might not work, judged against a bar set in advance.`,
    eyebrow: 'Proof of concept',
    body,
    script,
  });
}

export const pocTarget: RealizationTarget = {
  key: 'poc',
  name: 'Proof of concept',
  summary: 'The riskiest step isolated behind a trial harness, with a pass rate judged against a pre-set bar.',
  answers: 'Does the hard part actually work, reliably enough?',
  fidelity: 3,
  effort: 3,
  suits: ['ai-agent', 'search', 'data-import', 'verification', 'analytics'],
  strategy: 'declarative',

  build(ctx: RealizeContext): RealizationOutput {
    const { spec } = ctx;
    const riskiest = headlineCapabilities(spec, 1)[0]!;

    return {
      summary: `A ${TRIALS}-trial harness over "${riskiest}", reporting a pass rate against a ${Math.round(DEFAULT_PASS_RATE * 100)}% bar.`,
      files: {
        'poc/index.html': renderHarness(ctx),
        'poc/hypothesis.md': `# ${spec.title} — feasibility hypothesis

Filled in **before** the first trial. A bar chosen afterwards is a story about
the results.

## The one thing that might not work

${riskiest}.

Everything else in this idea is plumbing that has been built a thousand times.
If this step works at the required rate, the project is an engineering exercise.
If it does not, nothing else matters — which is why it is the only thing being
tested here.

> Rewrite the sentence above if the real risk is somewhere else. The riskiest
> step is usually not the most complicated one; it is the one whose failure you
> would only discover in front of a customer.

## The bar

| | |
|---|---|
| Trials | **${TRIALS}** |
| Must pass | **${Math.round(DEFAULT_PASS_RATE * 100)}%** (${Math.round(TRIALS * DEFAULT_PASS_RATE)} of ${TRIALS}) |
| Inputs | **Real** examples, including ones you expect to fail |

## Why ${Math.round(DEFAULT_PASS_RATE * 100)}%

Change this number if the cost of a failure is different. A step whose failure a
human notices and corrects can run at 80%. A step whose failure sends a wrong
message to a customer cannot run at 99%. Write the reason down here:

- Cost of one failure: ______________________
- Who notices it: ______________________
- Therefore the bar is: ______________________

## What "pass" means

Define it in one sentence, and define it before you see any output — grading
against a definition you formed while reading the results is not grading.

- A trial passes when: ______________________

## The result

| | |
|---|---|
| Date run | |
| Pass rate | |
| Verdict | build / redesign the step / stop |
| What the failures had in common | |

That last row is the valuable one. ${TRIALS} passes tell you to continue;
${Math.round(TRIALS * (1 - DEFAULT_PASS_RATE))} failures with something in common tell you what to build.
`,
      },
      handlers: {
        'poc-run': {
          name: 'poc-run',
          route: '/poc/run',
          method: 'POST',
          // Public because the harness is a page on the public site. It spends
          // model tokens, so the seeded ticket says to close it once the run is
          // done rather than leaving an open endpoint that costs money.
          verify: 'none',
          description: 'One trial of the risky step. Called once per input by the feasibility harness.',
          steps: [
            {
              kind: 'llm',
              id: 'attempt',
              system: `You perform ONE step of a system under evaluation: ${riskiest}. Context: ${spec.goal.slice(0, 400)}. Answer with the result only — no preamble, no explanation, no apology. If you cannot do it from what you were given, answer exactly: CANNOT.`,
              prompt: '{{body.input}}',
              maxTokens: 400,
            },
          ],
          respond: {
            kind: 'json',
            body: {
              input: '{{body.input}}',
              output: '{{steps.attempt}}',
            },
          },
        },
      },
      tasks: [
        {
          order: 10,
          title: 'Confirm that the isolated step is the actual risk',
          description:
            `The harness currently tests "${riskiest}", chosen from the brief's first capability. If the thing that would really sink this project is somewhere else, change it in poc/hypothesis.md and in the poc-run handler before spending a single trial.`,
          kind: 'setup',
        },
        {
          order: 20,
          title: 'Write the pass definition and the bar, before running anything',
          description:
            'poc/hypothesis.md has blanks for what "pass" means and why the bar is where it is. Fill them in first. Grading against a definition formed while reading the output is not grading.',
          kind: 'setup',
        },
        {
          order: 30,
          title: `Collect ${TRIALS} real inputs, including ones you expect to fail`,
          description:
            'A trial set of easy cases produces a pass rate that means nothing. Include the awkward ones — the truncated input, the wrong language, the case nobody thought of.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Run the trials and record what the failures had in common',
          description:
            'The pass rate decides go or no-go. The pattern in the failures is the specification for the next attempt, and it is lost if the run is not written up the same day.',
          kind: 'setup',
        },
        {
          order: 50,
          title: 'Close the /poc/run endpoint when the run is finished',
          description:
            'It is unauthenticated and it spends model tokens on every call — correct for a harness that has to work with zero setup, wrong for a route left open on a public site. Delete the handler or add shared-secret verification once the verdict is in.',
          kind: 'build',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [],
      successCriteria: criteriaFrom(spec, [
        `${TRIALS} trials run against real inputs, each judged pass or fail.`,
        `The pass rate is recorded against the pre-registered ${Math.round(DEFAULT_PASS_RATE * 100)}% bar, and a go/no-go decision is written down.`,
        'What the failures had in common is written down, whatever the verdict.',
      ]),
    };
  },
};
