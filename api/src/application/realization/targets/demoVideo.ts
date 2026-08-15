/**
 * `demo-video` — show it before it exists.
 *
 * The cheapest proof there is, and the one most teams skip because "we'll demo
 * it when it works". A recorded 90 seconds is what gets an idea into a board
 * pack, a sales call and an investor's inbox, and none of those need the system
 * to exist yet.
 *
 * ── WHAT IS ACTUALLY GENERATED ──────────────────────────────────────────────
 * Not a video file — this is not a rendering service, and a generated MP4 of
 * placeholder screens is worth less than nothing. What is generated is the thing
 * that makes recording one a twenty-minute job instead of a two-day one: a
 * timed, self-advancing reel you screen-record, and the narration script read
 * over it, with each line's duration matched to the scene it belongs to.
 *
 * The reel is a real page rather than a slide deck because it is published to the
 * project's site: it can be linked before it is ever recorded, which is often
 * enough on its own.
 */

import { esc, renderProofShell } from '../proofShell';
import { audienceOf, goalHeadline, headlineCapabilities } from './shared';
import type { RealizationTarget, RealizeContext, RealizationOutput } from '../realizationTarget';

interface Scene {
  id: string;
  seconds: number;
  eyebrow: string;
  headline: string;
  detail: string;
  voiceover: string;
}

/**
 * The scene list.
 *
 * Fixed shape — hook, problem, one scene per capability, proof, ask — because
 * that IS the demo that works, and a generator that improvised the structure per
 * brief would mostly improvise worse ones. Ninety seconds total at these
 * durations; anything longer stops being a demo and becomes a walkthrough.
 */
function scenesFor(ctx: RealizeContext): Scene[] {
  const { spec } = ctx;
  const capabilities = headlineCapabilities(spec, 4);
  const audience = audienceOf(spec);

  const scenes: Scene[] = [
    {
      id: 'hook',
      seconds: 8,
      eyebrow: 'The idea',
      headline: spec.title,
      detail: goalHeadline(spec),
      voiceover: `This is ${spec.title}. ${goalHeadline(spec)}`,
    },
    {
      id: 'problem',
      seconds: 12,
      eyebrow: 'Today',
      headline: 'What this replaces',
      detail: spec.constraints[0]
        ?? `Right now, ${audience} does this by hand — and every step of it is someone's afternoon.`,
      voiceover: `Today, ${audience} does this by hand. ${spec.constraints[0] ?? 'It is slow, it is inconsistent, and nobody enjoys it.'}`,
    },
  ];

  for (const [index, capability] of capabilities.entries()) {
    scenes.push({
      id: `capability-${index + 1}`,
      seconds: 12,
      eyebrow: `Step ${index + 1}`,
      headline: capability,
      detail: `Show this happening. Real screen, real data, no narration of the UI — say what it MEANS.`,
      voiceover: `${capability}. Watch what happens here — that is the part that used to take a person.`,
    });
  }

  scenes.push(
    {
      id: 'proof',
      seconds: 12,
      eyebrow: 'The evidence',
      headline: spec.successCriteria[0] ?? 'What changes, measurably',
      detail: spec.successCriteria[0]
        ? 'Put the number on screen. A claim without one is a slide.'
        : 'Decide the one number this has to move, and put it on screen.',
      voiceover: spec.successCriteria[0]
        ?? 'Here is the number this moves. Everything else in this demo is in service of that.',
    },
    {
      id: 'ask',
      seconds: 8,
      eyebrow: 'The ask',
      headline: 'What happens next',
      detail: 'One ask. A pilot, a budget, a design partner — not "thoughts?".',
      voiceover: `That is ${spec.title}. What we need next is one thing — say it, then stop talking.`,
    },
  );

  return scenes;
}

/** The narration script, with running timings so a recording can be paced. */
function renderScript(spec: { title: string }, scenes: readonly Scene[]): string {
  let elapsed = 0;
  const rows = scenes.map((scene) => {
    const start = elapsed;
    elapsed += scene.seconds;
    const mmss = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    return [
      `### ${mmss(start)} — ${scene.eyebrow}: ${scene.headline}  *(${scene.seconds}s)*`,
      '',
      `**On screen:** ${scene.detail}`,
      '',
      `**Say:** ${scene.voiceover}`,
      '',
    ].join('\n');
  });

  return `# ${spec.title} — demo script

Total run time: **${elapsed} seconds**. That is the whole budget, and it is not
negotiable: the drop-off on a product demo is brutal after ninety seconds, and a
demo that needs three minutes is a demo that has not decided what it is about.

Read it out loud once before recording. Any sentence you stumble over is a
sentence that is too long.

---

${rows.join('\n')}
---

## Recording it

1. Open \`demo/index.html\` — it advances itself at the timings above.
2. Screen-record it (Cmd/Ctrl + Shift + 5 on macOS, Win + G on Windows, or any
   capture tool) with the narration above read over the top.
3. Do it in one take. A cut demo is a demo you will re-cut forever.
4. If a scene needs more than its allotted seconds to explain, the scene is wrong
   — not the timing.
`;
}

function renderReel(spec: { title: string; goal: string }, scenes: readonly Scene[]): string {
  const body = `  <div class="card" id="stage">
    <p class="eyebrow" id="scene-eyebrow"></p>
    <h2 id="scene-headline" style="font-size:clamp(22px,5vw,36px);margin-bottom:12px"></h2>
    <p id="scene-detail" class="muted" style="font-size:clamp(15px,2.4vw,19px);margin:0"></p>
    <div class="bar"><i id="scene-progress" style="width:0%"></i></div>
  </div>

  <section>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <button type="button" id="play">Play</button>
      <button type="button" class="ghost" id="restart">Restart</button>
      <span class="muted" id="clock" style="font-variant-numeric:tabular-nums"></span>
    </div>
    <p class="muted" style="margin-top:12px;font-size:14px">
      Space plays and pauses. Left and right arrows step between scenes. Screen-record
      this page and read <code>demo/script.md</code> over it.
    </p>
  </section>

  <section>
    <h2>Scenes</h2>
    <div class="card scroll">
      <table>
        <thead><tr><th>#</th><th>Scene</th><th>Say</th><th>Length</th></tr></thead>
        <tbody id="scene-list"></tbody>
      </table>
    </div>
  </section>

  <footer>${esc(spec.goal)}</footer>`;

  const script = `  var SCENES = ${JSON.stringify(scenes)};
  var index = 0, elapsed = 0, timer = null;

  var el = {
    eyebrow: document.getElementById('scene-eyebrow'),
    headline: document.getElementById('scene-headline'),
    detail: document.getElementById('scene-detail'),
    progress: document.getElementById('scene-progress'),
    clock: document.getElementById('clock'),
    play: document.getElementById('play'),
  };

  var TOTAL = SCENES.reduce(function (sum, s) { return sum + s.seconds; }, 0);

  function paint() {
    var scene = SCENES[index];
    el.eyebrow.textContent = scene.eyebrow;
    el.headline.textContent = scene.headline;
    el.detail.textContent = scene.detail;
    el.progress.style.width = Math.min(100, (elapsed / scene.seconds) * 100) + '%';
    var before = SCENES.slice(0, index).reduce(function (sum, s) { return sum + s.seconds; }, 0);
    el.clock.textContent = Math.round(before + elapsed) + 's of ' + TOTAL + 's';
    document.querySelectorAll('[data-scene]').forEach(function (row) {
      row.style.opacity = Number(row.getAttribute('data-scene')) === index ? '1' : '.55';
    });
  }

  function tick() {
    elapsed += 0.1;
    if (elapsed >= SCENES[index].seconds) {
      // Stop at the end rather than looping: a reel that restarts under a
      // recording produces a take with the hook twice.
      if (index === SCENES.length - 1) { pause(); elapsed = SCENES[index].seconds; paint(); return; }
      index++; elapsed = 0;
    }
    paint();
  }

  function play() { if (timer) return; timer = setInterval(tick, 100); el.play.textContent = 'Pause'; }
  function pause() { clearInterval(timer); timer = null; el.play.textContent = 'Play'; }
  function toggle() { timer ? pause() : play(); }
  function go(next) { pause(); index = Math.max(0, Math.min(SCENES.length - 1, next)); elapsed = 0; paint(); }

  document.getElementById('scene-list').innerHTML = SCENES.map(function (s, i) {
    return '<tr data-scene="' + i + '" style="cursor:pointer"><td>' + (i + 1) + '</td><td><strong>' +
      s.headline + '</strong><br><span class="muted">' + s.eyebrow + '</span></td><td>' +
      s.voiceover + '</td><td>' + s.seconds + 's</td></tr>';
  }).join('');
  document.querySelectorAll('[data-scene]').forEach(function (row) {
    row.addEventListener('click', function () { go(Number(row.getAttribute('data-scene'))); });
  });

  el.play.addEventListener('click', toggle);
  document.getElementById('restart').addEventListener('click', function () { go(0); });
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });

  paint();`;

  return renderProofShell({
    title: `${spec.title} — demo reel`,
    subtitle: 'A timed, self-advancing reel. Screen-record it and read the script over the top.',
    eyebrow: 'Demo video',
    body,
    script,
  });
}

export const demoVideoTarget: RealizationTarget = {
  key: 'demo-video',
  name: 'Demo video',
  summary: 'A timed reel and a narration script, so a recordable 90-second demo exists today.',
  answers: 'Can you show me what this is?',
  fidelity: 1,
  effort: 1,
  suits: [],
  strategy: null,

  build(ctx: RealizeContext): RealizationOutput {
    const scenes = scenesFor(ctx);
    const runtime = scenes.reduce((sum, s) => sum + s.seconds, 0);

    return {
      summary: `A ${runtime}-second demo reel and its narration script, ready to record.`,
      files: {
        'demo/index.html': renderReel(ctx.spec, scenes),
        'demo/script.md': renderScript(ctx.spec, scenes),
        'demo/storyboard.json': `${JSON.stringify({ title: ctx.spec.title, runtimeSeconds: runtime, scenes }, null, 2)}\n`,
      },
      handlers: {},
      tasks: [
        {
          order: 10,
          title: 'Record the demo in one take',
          description:
            'Open demo/index.html, press Play, screen-record it and read demo/script.md over the top. One take. A demo you keep re-cutting is a demo that never ships, and the second take is almost never better than the first.',
          kind: 'setup',
        },
        {
          order: 20,
          title: 'Replace the placeholder scenes with real screens',
          description:
            'Each capability scene currently describes what to show. Swap the description for a real recording or screenshot of the thing itself — a demo of described features converts nobody.',
          kind: 'build',
        },
        {
          order: 30,
          title: 'Put the number in the proof scene',
          description:
            'The proof scene has to carry one measurable claim. If there is not a number yet, that is the finding: run a smoke test or a pilot before the demo goes to anyone who can say no.',
          kind: 'setup',
        },
        {
          order: 40,
          title: 'Send it to five people outside the team',
          description:
            'Ask each one what they think it does, before you explain. Where their answer differs from the intent is exactly where the demo is wrong.',
          kind: 'setup',
        },
      ],
      requiredConnectors: [],
      requiredSecrets: [],
      requiredCollections: [],
      successCriteria: [
        `A ${runtime}-second recording exists and is linkable.`,
        'Five people outside the team can say what it does without being told.',
        'The demo makes exactly one ask, and the ask is specific.',
      ],
    };
  },
};
