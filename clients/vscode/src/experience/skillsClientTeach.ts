/**
 * The Skills page, part 2 of 3: Teach. Pick a program, record, then review what was
 * recorded (rename, remove steps, pin values, toggle approval gates, name parameters)
 * and compile. The review's edits are the engine's `ReviewEdits` shape, keyed by step id.
 */
export const SKILLS_CLIENT_TEACH = String.raw`
function syncReview() {
  var rv = S && S.review;
  if (!rv) { ui.review = null; return; }
  if (ui.review && ui.review.episodeId === rv.episodeId) return;
  var approvals = {};
  rv.steps.forEach(function (st) { approvals[st.id] = st.requiresApproval; });
  ui.review = { episodeId: rv.episodeId, name: rv.name, removed: {}, fixed: {}, approvals: approvals, paramNames: {} };
}

function stepText(st) {
  if (st.kind === 'click') return fmt('stepClick', st.target);
  if (st.kind === 'setValue') return fmt('stepType', st.target);
  return fmt('stepKeys', st.target);
}

function reviewEdits(rv) {
  var r = ui.review;
  var edits = { name: r.name, removed: [], fixed: [], approvals: {}, paramNames: {} };
  rv.steps.forEach(function (st) {
    if (r.removed[st.id]) { edits.removed.push(st.id); return; }
    if (r.fixed[st.id]) edits.fixed.push(st.id);
    if (r.approvals[st.id] !== st.requiresApproval) edits.approvals[st.id] = r.approvals[st.id];
    if (r.paramNames[st.id]) edits.paramNames[st.id] = r.paramNames[st.id];
  });
  return edits;
}

function reviewStep(st) {
  var r = ui.review;
  var kept = !r.removed[st.id];
  var pinnable = st.isValue && !st.secret;
  return h('div', { class: 'step stack' },
    check(stepText(st), kept, function (on) { r.removed[st.id] = !on; render(); }),
    kept && st.isValue && !(pinnable && r.fixed[st.id]) ? h('div', { class: 'stack' },
      h('label', { class: 'block' }, L.paramName, textInput(r.paramNames[st.id] || st.paramName, function (v) { r.paramNames[st.id] = v; })),
      st.secret ? h('p', { class: 'muted' }, L.secretValue) : null) : null,
    kept && pinnable ? check(L.pinValue, r.fixed[st.id], function (on) { r.fixed[st.id] = on; render(); }) : null,
    kept ? check(L.askBefore, r.approvals[st.id], function (on) { r.approvals[st.id] = on; }) : null);
}

function reviewForm(rv) {
  var r = ui.review;
  return card(
    h('h3', {}, L.review),
    h('p', { class: 'muted mono' }, rv.program),
    h('label', { class: 'block' }, L.skillName, textInput(r.name, function (v) { r.name = v; })),
    rv.steps.map(reviewStep),
    row(button(L.compile, function () { post({ type: 'review.compile', episodeId: rv.episodeId, edits: reviewEdits(rv) }); }),
        button(L.discard, function () { post({ type: 'review.discard', episodeId: rv.episodeId }); }, 'secondary')));
}

function teachSection() {
  var rec = S.recording;
  var kids = [h('h2', {}, L.teach)];
  if (S.review && ui.review) kids.push(reviewForm(S.review));
  else if (rec) kids.push(card(
    h('p', { id: 'rec-count' }, fmt('recordingSteps', rec.count)),
    row(button(L.stopRecording, function () { post({ type: 'record.stop' }); }))));
  else kids.push(card(
    row(h('span', { class: 'grow mono' }, ui.program || L.noProgram), button(L.chooseProgram, function () { post({ type: 'program.pick' }); }, 'secondary')),
    row(button(L.record, function () { post({ type: 'record.start', program: ui.program }); }, '', !ui.program || !!S.live))));
  return kids;
}
`;
