/**
 * `clickable-prototype` — test the flow before building it.
 *
 * A prototype answers a question a demo cannot: not "do you like it?" but "can
 * you do it?". So this one is instrumented. Every click is recorded against the
 * screen it happened on, and the session can be exported — because the finding
 * that matters is where someone hesitated, and that is invisible if you only
 * watch them finish.
 *
 * ── WHY IT HAS NO BACKEND ───────────────────────────────────────────────────
 * `strategy: null`, deliberately. A prototype that needs a deploy is not a
 * prototype; it is a slow version of the product. This is one HTML file that
 * runs from a file:// URL, which is what makes it usable in a room with someone
 * on a laptop that has never seen this project.
 */

import { esc, renderProofShell } from '../proofShell';
import { audienceOf, goalHeadline, headlineCapabilities } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

interface Screen {
  id: string;
  name: string;
  purpose: string;
  /** What the participant is meant to do here. */
  action: string;
}

function screensFor(ctx: RealizeContext): Screen[] {
  const { spec } = ctx;
  const capabilities = headlineCapabilities(spec, 4);

  return [
    {
      id: 'start',
      name: 'Start',
      purpose: goalHeadline(spec),
      action: 'Begin the task',
    },
    ...capabilities.map((capability, index) => ({
      id: `step-${index + 1}`,
      name: capability,
      purpose: `The ${capability.toLowerCase()} step. Replace this with the real screen — layout, labels and all.`,
      action: index === capabilities.length - 1 ? 'Finish' : 'Continue',
    })),
    {
      id: 'done',
      name: 'Done',
      purpose: 'What the participant should now believe has happened, in their words.',
      action: 'Start again',
    },
  ];
}

function renderPrototype(ctx: RealizeContext, screens: readonly Screen[]): string {
  const { spec } = ctx;
  const task = spec.successCriteria[0] ?? goalHeadline(spec);

  const body = `  <div class="card" style="border-left:4px solid var(--accent)">
    <p class="label">Your task</p>
    <p style="margin:0;font-size:17px">${esc(task)}</p>
    <p class="muted" style="margin:8px 0 0;font-size:14px">
      Work through it on your own. Say out loud what you are thinking. There are no wrong turns —
      anywhere you get stuck is the finding.
    </p>
  </div>

  <section>
    <div class="card" id="screen">
      <p class="eyebrow" id="screen-step"></p>
      <h2 id="screen-name"></h2>
      <p class="muted" id="screen-purpose"></p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:24px">
        <button type="button" id="advance"></button>
        <button type="button" class="ghost" id="back">Back</button>
        <button type="button" class="ghost" id="stuck">I am stuck</button>
      </div>
    </div>
    <div class="bar"><i id="flow-progress" style="width:0%"></i></div>
  </section>

  <section>
    <h2>Session</h2>
    <p class="muted" style="margin-top:0;font-size:14px">
      Recorded in this browser only — nothing leaves the page. Export it after each participant.
    </p>
    <div class="card scroll">
      <table>
        <thead><tr><th>At</th><th>Screen</th><th>Event</th></tr></thead>
        <tbody id="events"><tr><td colspan="3" class="muted">Nothing yet.</td></tr></tbody>
      </table>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">
      <button type="button" class="ghost" id="export">Export session</button>
      <button type="button" class="ghost" id="clear">Clear</button>
    </div>
  </section>

  <footer>${esc(spec.title)} — clickable prototype. Nothing here is real: no data is saved and no message is sent.</footer>`;

  const script = `  var SCREENS = ${JSON.stringify(screens)};
  var index = 0;
  var startedAt = Date.now();
  var events = [];

  var el = {
    step: document.getElementById('screen-step'),
    name: document.getElementById('screen-name'),
    purpose: document.getElementById('screen-purpose'),
    advance: document.getElementById('advance'),
    back: document.getElementById('back'),
    progress: document.getElementById('flow-progress'),
    events: document.getElementById('events'),
  };

  function record(event) {
    events.push({ at: Math.round((Date.now() - startedAt) / 1000), screen: SCREENS[index].id, event: event });
    el.events.innerHTML = events.map(function (e) {
      return '<tr><td>' + e.at + 's</td><td>' + e.screen + '</td><td>' + e.event + '</td></tr>';
    }).join('');
  }

  function paint() {
    var screen = SCREENS[index];
    el.step.textContent = 'Screen ' + (index + 1) + ' of ' + SCREENS.length;
    el.name.textContent = screen.name;
    el.purpose.textContent = screen.purpose;
    el.advance.textContent = screen.action;
    el.back.disabled = index === 0;
    el.progress.style.width = ((index / (SCREENS.length - 1)) * 100) + '%';
  }

  el.advance.addEventListener('click', function () {
    record('advance: ' + SCREENS[index].action);
    // The last screen loops to the start so a second participant can sit down
    // without anyone reloading anything.
    index = index === SCREENS.length - 1 ? 0 : index + 1;
    if (index === 0) startedAt = Date.now();
    paint();
  });
  el.back.addEventListener('click', function () {
    record('back');
    index = Math.max(0, index - 1);
    paint();
  });
  document.getElementById('stuck').addEventListener('click', function () {
    // The most valuable event in the log, and the one that never gets captured
    // when a facilitator is watching politely.
    record('STUCK');
  });

  document.getElementById('export').addEventListener('click', function () {
    var lines = ['seconds,screen,event'].concat(events.map(function (e) {
      return e.at + ',' + e.screen + ',"' + String(e.event).replace(/"/g, '""') + '"';
    }));
    // Rendered into the page rather than downloaded: a download initiated by a
    // script is blocked in a sandboxed preview, and a blocked export looks like
    // a broken prototype at exactly the wrong moment.
    var out = document.createElement('pre');
    out.className = 'card mono';
    out.style.whiteSpace = 'pre-wrap';
    out.textContent = lines.join('\\n');
    document.querySelector('.wrap').appendChild(out);
  });
  document.getElementById('clear').addEventListener('click', function () {
    events = []; startedAt = Date.now(); index = 0;
    el.events.innerHTML = '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>';
    paint();
  });

  paint();`;

  return renderProofShell({
    title: `${spec.title} — prototype`,
    subtitle: `Click through the flow as ${audienceOf(spec)} would. Every click is recorded so the stuck points are visible afterwards.`,
    eyebrow: 'Clickable prototype',
    body,
    script,
  });
}

export const clickablePrototypeTarget: RealizationTarget = {
  key: 'clickable-prototype',
  name: 'Clickable prototype',
  summary: 'An instrumented click-through of the flow, with no backend and no data.',
  answers: 'Can someone actually complete this without help?',
  fidelity: 2,
  effort: 2,
  suits: ['dashboard', 'auth', 'scheduling', 'chat'],
  strategy: null,

  build(ctx: RealizeContext): RealizationOutput {
    const screens = screensFor(ctx);

    return {
      summary: `A ${screens.length}-screen click-through with a recorded click log, testable on any laptop.`,
      files: {
        'prototype/index.html': renderPrototype(ctx, screens),
        'prototype/flow.json': `${JSON.stringify({ title: ctx.spec.title, screens }, null, 2)}\n`,
        'prototype/sessions.md': `# ${ctx.spec.title} — usability sessions

One row per participant. Fill it in immediately after each session, not at the
end of the day: the thing you remember an hour later is the thing that confirmed
what you already believed.

| # | Who | Finished unaided? | Where they stalled | What they said it does |
|---|-----|-------------------|--------------------|------------------------|
| 1 |     |                   |                    |                        |
| 2 |     |                   |                    |                        |
| 3 |     |                   |                    |                        |
| 4 |     |                   |                    |                        |
| 5 |     |                   |                    |                        |

## The rule

Five participants. Do not change the prototype between them — a flow that is
edited after every session is a flow that has been tested once, five times.

## The finding

Fewer than four of five finishing unaided is not "we need to explain it better".
It is the flow.
`,
      },
      handlers: {},
      tasks: [
        {
          order: 10,
          title: 'Replace the placeholder screens with the real ones',
          description:
            'Each step screen currently describes itself. Put the actual layout, labels and copy in — a prototype tested against descriptions tests nothing but the description.',
          kind: 'build',
        },
        {
          order: 20,
          title: 'Run five sessions without changing anything between them',
          description:
            'Recruit five people who match the audience, give them the task on the first card, and stay quiet. Record each in prototype/sessions.md. Editing between participants turns five tests into one.',
          kind: 'setup',
        },
        {
          order: 30,
          title: 'Fix only what more than one person hit',
          description:
            'One person stumbling is a person. Two is the flow. Fixing every single-participant comment is how a prototype absorbs a week and proves nothing.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [],
      successCriteria: [
        'Five participants have run the task, recorded in prototype/sessions.md.',
        'At least four of five completed it unaided.',
        'Every stall hit by two or more participants has a decision against it.',
      ],
    };
  },
};
