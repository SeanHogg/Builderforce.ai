/**
 * The Skills page, part 3 of 3: the skill cards and their forms. Run asks for the
 * parameters (secrets in password inputs, with "Remember on this computer"); Schedule
 * sets a routine, either every N minutes or daily at a time.
 */
export const SKILLS_CLIENT_SKILLS = String.raw`
function valKey(skillId, name) { return skillId + '|' + name; }

// A kept secret stays ticked until the person unticks it; unticking forgets it.
function remembered(p, k) { return ui.remember[k] !== undefined ? !!ui.remember[k] : !!p.kept; }

function runForm(s) {
  var inputs = s.params.map(function (p) {
    var k = valKey(s.id, p.name);
    var start = ui.vals[k] !== undefined ? ui.vals[k] : (p.secret ? '' : (p.default || ''));
    return h('div', { class: 'stack' },
      h('label', { class: 'block' }, p.label || p.name, textInput(start, function (v) { ui.vals[k] = v; }, p.secret ? 'password' : 'text', p.secret && p.kept ? L.secretKept : '')),
      p.secret ? check(L.rememberSecret, remembered(p, k), function (on) { ui.remember[k] = on; }) : null);
  });
  return h('div', { class: 'stack' }, inputs, row(
    button(L.startRun, function () {
      var values = {};
      var remember = [];
      s.params.forEach(function (p) {
        var k = valKey(s.id, p.name);
        var v = ui.vals[k] !== undefined ? ui.vals[k] : (p.secret ? '' : (p.default || ''));
        if (v) values[p.name] = v;
        if (p.secret && remembered(p, k)) remember.push(p.name);
      });
      s.params.forEach(function (p) { if (p.secret) delete ui.vals[valKey(s.id, p.name)]; });
      ui.runForm = null;
      post({ type: 'run.start', skillId: s.id, values: values, remember: remember });
      render();
    }, '', !!S.live),
    button(L.cancel, function () { ui.runForm = null; render(); }, 'secondary')));
}

function schedState(s) {
  if (!ui.sched[s.id]) {
    var r = s.routine;
    var sc = r && r.schedule;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    ui.sched[s.id] = {
      kind: sc && sc.every === 'day' ? 'day' : 'minutes',
      minutes: sc && sc.every === 'minutes' ? sc.minutes : 15,
      time: sc && sc.every === 'day' ? pad(sc.hour) + ':' + pad(sc.minute) : '09:00',
      enabled: r ? r.enabled : true,
      values: r ? Object.assign({}, r.values) : {}
    };
  }
  return ui.sched[s.id];
}

function schedForm(s) {
  var st = schedState(s);
  var plain = s.params.filter(function (p) { return !p.secret; });
  return h('div', { class: 'stack' },
    h('label', {}, h('input', { type: 'radio', name: 'kind-' + s.id, checked: st.kind === 'minutes', onchange: function () { st.kind = 'minutes'; render(); } }), L.everyMinutes),
    st.kind === 'minutes' ? row(h('input', { type: 'number', min: 1, value: st.minutes, oninput: function (e) { st.minutes = parseInt(e.target.value, 10) || 1; } }), L.minutes) : null,
    h('label', {}, h('input', { type: 'radio', name: 'kind-' + s.id, checked: st.kind === 'day', onchange: function () { st.kind = 'day'; render(); } }), L.dailyAt),
    st.kind === 'day' ? h('input', { type: 'time', value: st.time, oninput: function (e) { st.time = e.target.value; } }) : null,
    plain.map(function (p) {
      return h('label', { class: 'block' }, p.label || p.name, textInput(st.values[p.name] !== undefined ? st.values[p.name] : (p.default || ''), function (v) { st.values[p.name] = v; }));
    }),
    check(L.enabled, st.enabled, function (on) { st.enabled = on; }),
    row(
      button(L.save, function () {
        var parts = (st.time || '09:00').split(':');
        var schedule = st.kind === 'minutes'
          ? { every: 'minutes', minutes: Math.max(1, st.minutes | 0) }
          : { every: 'day', hour: parseInt(parts[0], 10) || 0, minute: parseInt(parts[1], 10) || 0 };
        var values = {};
        plain.forEach(function (p) {
          var v = st.values[p.name] !== undefined ? st.values[p.name] : (p.default || '');
          if (v) values[p.name] = v;
        });
        ui.schedForm = null;
        delete ui.sched[s.id];
        post({ type: 'skill.schedule', skillId: s.id, routine: { schedule: schedule, values: values, enabled: st.enabled } });
        render();
      }),
      s.routine ? button(L.removeRoutine, function () { ui.schedForm = null; delete ui.sched[s.id]; post({ type: 'skill.schedule', skillId: s.id, routine: null }); render(); }, 'secondary') : null,
      button(L.cancel, function () { ui.schedForm = null; delete ui.sched[s.id]; render(); }, 'secondary')));
}

function skillCard(s) {
  var routine = s.routine ? L.routine + ': ' + scheduleText(s.routine.schedule) + (s.routine.enabled ? '' : ' ' + L.routineOff) : null;
  return card(
    h('h3', {}, s.name),
    h('p', { class: 'muted' }, fmt('stepsCount', s.stepCount) + ' · ' + s.program),
    routine ? h('p', {}, routine) : null,
    row(
      button(L.run, function () { ui.runForm = ui.runForm === s.id ? null : s.id; ui.schedForm = null; render(); }, '', !!S.live),
      button(L.schedule, function () { ui.schedForm = ui.schedForm === s.id ? null : s.id; ui.runForm = null; render(); }, 'secondary'),
      button(L.delete, function () { post({ type: 'skill.delete', skillId: s.id }); }, 'danger')),
    ui.runForm === s.id ? runForm(s) : null,
    ui.schedForm === s.id ? schedForm(s) : null);
}

function skillsSection() {
  return [h('h2', {}, L.skills), S.skills.length ? S.skills.map(skillCard) : h('p', { class: 'muted' }, L.noSkills)];
}
`;
