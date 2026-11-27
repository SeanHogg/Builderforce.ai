/**
 * The Skills page, part 1 of 3: state, DOM helpers, the live-run card, run history, the
 * phone toggle and the top-level render. Plain browser JS held as a string (the page has
 * no bundle). Rules for all three parts: no template-literal syntax, and no
 * `innerHTML` — every node is built with `h()` and text nodes, so host data can never
 * become markup.
 */
export const SKILLS_CLIENT_CORE = String.raw`
var api = acquireVsCodeApi();
var S = null;
var L = {};
var ui = { program: null, review: null, runForm: null, schedForm: null, vals: {}, remember: {}, sched: {}, open: {} };

function post(msg) { api.postMessage(msg); }

function fmt(key) {
  var s = L[key] || key;
  for (var i = 1; i < arguments.length; i++) s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
  return s;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function h(tag, attrs) {
  var el = document.createElement(tag);
  var a = attrs || {};
  Object.keys(a).forEach(function (k) {
    var v = a[k];
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') el.className = v;
    else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  });
  for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}

function add(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { add(el, c); }); return; }
  el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
}

function button(label, onclick, cls, disabled) {
  return h('button', { type: 'button', class: cls || '', onclick: onclick, disabled: !!disabled }, label);
}

function row() { return h.apply(null, ['div', { class: 'row' }].concat([].slice.call(arguments))); }

function card() { return h.apply(null, ['div', { class: 'card' }].concat([].slice.call(arguments))); }

function check(label, checked, onchange, disabled) {
  return h('label', {}, h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: function (e) { onchange(e.target.checked); } }), label);
}

function textInput(value, oninput, type, placeholder) {
  return h('input', { type: type || 'text', value: value || '', placeholder: placeholder || '', oninput: function (e) { oninput(e.target.value); } });
}

function liveCard() {
  var l = S.live;
  if (!l) return null;
  var a = l.approval;
  return h('div', { class: 'card live' + (a ? ' attention' : '') },
    h('h3', {}, fmt('running', l.skillName)),
    h('p', { class: 'muted' }, l.currentStep ? fmt('stepOf', l.currentStep, l.totalSteps) : L.starting),
    l.totalSteps ? h('progress', { max: l.totalSteps, value: l.currentStep || 0 }) : null,
    a ? h('div', { class: 'stack' },
      h('strong', {}, L.approvalTitle),
      h('p', {}, a.description),
      row(button(L.approve, function () { post({ type: 'approval.answer', approved: true }); }),
          button(L.deny, function () { post({ type: 'approval.answer', approved: false }); }, 'secondary'))) : null,
    row(button(L.stop, function () { post({ type: 'run.stop' }); }, 'danger')));
}

function phoneToggle() {
  return h('div', {}, row(check(L.phoneApprovals, S.phoneApprovals, function (on) { post({ type: 'phone.set', on: on }); }, !S.signedIn)),
    S.signedIn ? null : h('p', { class: 'muted' }, L.phoneApprovalsNeedSignIn));
}

function scheduleText(sch) {
  if (sch.every === 'minutes') return fmt('routineEvery', sch.minutes);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return fmt('routineDaily', pad(sch.hour) + ':' + pad(sch.minute));
}

function runRow(r) {
  var when = new Date(r.startedAt).toLocaleString();
  var trig = r.trigger === 'routine' ? L.triggerRoutine : L.triggerManual;
  return h('details', { open: !!ui.open[r.id], ontoggle: function (e) { ui.open[r.id] = e.target.open; } },
    h('summary', {}, r.skillName + ' ', h('span', { class: 'badge ' + r.status }, L['status' + cap(r.status)] || r.status), ' ', h('span', { class: 'muted' }, trig + ' · ' + when)),
    r.error ? h('p', { class: 'muted' }, r.error) : null,
    h('strong', {}, L.stepDetail),
    r.steps.length ? r.steps.map(function (s) {
      return h('div', { class: 'step' }, h('span', { class: 'mono' }, '#' + (s.idx + 1) + ' '),
        h('span', { class: 'badge ' + s.outcome }, L['outcome' + cap(s.outcome)] || s.outcome),
        s.detail ? h('span', { class: 'muted' }, ' ' + s.detail) : null);
    }) : h('p', { class: 'muted' }, L.noSteps));
}

function historySection() {
  return [h('h2', {}, L.history), S.runs.length ? S.runs.map(runRow) : h('p', { class: 'muted' }, L.noRuns)];
}

function unsupportedView() {
  return card(h('h3', {}, L.unsupportedTitle), h('p', { class: 'muted' }, L.unsupportedBody));
}

function disabledView() {
  return card(h('h3', {}, L.disabledTitle), h('p', { class: 'muted' }, L.disabledBody), row(button(L.turnOn, function () { post({ type: 'enable' }); })));
}

function render() {
  if (!S) return;
  var root = document.getElementById('root');
  var kids = [];
  if (S.error) kids.push(h('div', { class: 'error', role: 'alert' }, fmt('errorPrefix', S.error)));
  if (!S.supported) kids.push(unsupportedView());
  else if (!S.enabled) kids.push(disabledView());
  else kids.push(liveCard(), teachSection(), skillsSection(), phoneToggle(), historySection());
  root.replaceChildren.apply(root, kids.flat(2).filter(Boolean));
}

function boot() {
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'state') { S = m.state; L = m.labels; syncReview(); render(); }
    else if (m.type === 'recording.count') {
      if (S && S.recording) S.recording.count = m.count;
      var el = document.getElementById('rec-count');
      if (el) el.textContent = fmt('recordingSteps', m.count);
    } else if (m.type === 'program.picked') { ui.program = m.program; render(); }
  });
  post({ type: 'ready' });
}
`;
