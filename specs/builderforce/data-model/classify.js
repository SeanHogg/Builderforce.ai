const DOMAINS = [
  ['Identity & tenancy',   'the platform',  /^(users?|tenants?|accounts?|companies|company_|segments?|workspaces?|teams?|team_|members?|member_|roles?|permissions?|auth|sessions?|mfa|password|oauth|impersonation|user_|onboarding|invitations?|regions?|countries|state_provinces|locales?)/],
  ['Canvas & ideas',       'Brain',         /^(creation_|canvas|objects?|artifacts?|studio_|nle_|voice|render|media_|stock_|game_|prototype|drawing|whiteboard|prompt_|brain_)/],
  ['Delivery & work',      'Manager',       /^(tasks?|task_|epics?|stories|subtasks?|sprints?|swimlane|kanban|boards?|board_|projects?|project_|roadmap|releases?|deploy|pmo_|initiatives?|portfolios?|objectives?|key_results?|milestones?|ceremon|retro|poker|standup|velocity|capacity|estimat|delay|spec_|specs?|qa_|test_|bug|incident|deliverable)/],
  ['Agents & runtime',     'the platform',  /^(agents?|agent_|executions?|dispatch|manager_|skills?|skill_|mcp_|hosts?|host_|workers?|evermind|models?|llm_|ai_|inference|training|tool_|tools?)/],
  ['Finance',              'CFO',           /^(financial|finance|runway|burn|forecast|budget|expense|revenue|invoice|billing|payment|plaid|cash|valuation|funding|cap_table|pricing|plan_|plans?|subscription|credits?|usage_|meter|cost_|costs?|tax|payroll|rd_)/],
  ['Revenue & CRM',        'CRO',           /^(deals?|deal_|pipelines?|leads?|prospect|contacts?|contact_|crm|calls?|call_|sales_|quotes?|proposals?|ri_|phone|sms|voip|opportunit)/],
  ['Growth & marketing',   'CMO',           /^(marketing_|campaigns?|campaign_|audiences?|newsletters?|emails?|email_|heatmap|seo_|landing|ab_|experiments?|nurture|referral|affiliate|feed_|articles?|content_|blog|social|ads?|ad_|paid_media|boosts?|events?|event_)/],
  ['Hiring',               'Recruiter',     /^(jobs?|job_|postings?|applications?|application_|candidates?|candidate_|talent|screening|interviews?|interview_|scorecards?|ats_|resumes?|resume_|recruiter_|placements?|offers?|references?|reference_|cohorts?|hires?|hiring)/],
  ['People & HR',          'HR',            /^(people_|employees?|employee_|hr_|org_|headcount|performance|review_cycle|pto|pulse|check_in|one_on_one|career|coaching|learning|courses?|course_|certificat|lessons?|competenc|badges?|points_|rewards?|gamif)/],
  ['Governance & security','Security',      /^(security_|soc_|compliance|controls?|evidence|dpa|privacy|pii|gdpr|data_subject|consent|audits?|access_|policies|policy|legal_|terms|risk_|vendors?|vendor_)/],
  ['Support & knowledge',  'Support',       /^(support_|tickets?_|helpdesk|knowledge_|sop_|docs?_|documents?|faq|help_|feedback|nps|csat)/],
  ['Commerce',             'the platform',  /^(marketplace_|listings?|purchases?|orders?|carts?|checkout|payouts?|sellers?|consultants?|freelancer|engagements?|bookings?|booking_|reservations?|services?|offerings?|gigs?)/],
  ['Investor & portfolio', 'CEO',           /^(investor_|pitch_|decks?|deck_|data_rooms?|due_diligence|portfolio_compan|peer_|market_|competitor|competitive|benchmark|mvp_|validation|scratch_)/],
  ['Integrations',         'the platform',  /^(integrations?|integration_|connectors?|connector_|connections?|webhooks?|providers?|import|export|migration|external_|board_sync|drive_|mailbox_|calendar_|linkedin|youtube|slack|twilio|github|gitlab|jira|development_)/],
  ['Platform & observability','the platform',/^(errors?|error_|uptime|monitoring|alerts?|logs?|metrics?|dashboards?|widgets?|insights?|reports?|notifications?|push_|cron|queues?|feature_|flags?|settings?|system_|admin_|platform_|changelog|api_|rate_limit|cache)/],
];

// PASS 2 — token vocabulary (recall). Any token anywhere in the name.
const VOCAB = {
  'Finance': ['arr','mrr','revenue','burn','runway','breakeven','break','payback','churn','cac','ltv','margin','ebitda','quota','attainment','kpi','kpis','calculation','calculations','scenario','scenarios','assumption','assumptions','montecarlo','monte','carlo','simulation','simulations','projection','projections','compensation','discount','redemption','redemptions','timecard','timecards','timesheet','timesheets','roi'],
  'Delivery & work': ['contributor','contributors','contribution','signoff','signoffs','approval','approvals','bottleneck','rehearsal','rehearsals','oncall','rotation','rotations','incident','incidents','escalation','pr','repo','repos','branch','branches','reconciliation','delta','deltas','workitem','work','action','items','sprint','velocity','estimate','sync','agenda','conflict','resolutions','dev','teams'],
  'Agents & runtime': ['workflow','workflows','automation','automations','trigger','triggers','prompt','prompts','answer','cache','memory','memories','fact','facts','ide','dataset','datasets','outcome','outcomes','telemetry','span','spans','lease','leases','monitor','monitors'],
  'Growth & marketing': ['campaign','audience','journey','journeys','touchpoint','touchpoints','channel','performance','enrollment','enrollments','followup','follow','waitlist','promo','announcement','banner','banners','podcast','outreach','brand','branding','website','site','page','pages','video','videos','embed','widget','collection','collections','traffic','daily','feed','signals','suppression'],
  'Revenue & CRM': ['contact','contacts','list','lists','search','searches','saved','communication','tracking','enrichment','geocoder','city','cities','phone'],
  'Hiring': ['position','positions','retained','firm','firms','employer','outplacement','package','packages','ramp','assessment','dimension','norms'],
  'People & HR': ['learn','lms','scorm','cmi','lrs','course','courses','trait','reinforcement','reinforcements','health','dimensions'],
  'Governance & security': ['vulnerability','vulnerabilities','scan','scans','finding','findings','webauthn','challenge','challenges','device','authorization','authorizations'],
  'Commerce': ['whitelabel','agency','agencies','client','clients','seat','addon','addons','license','licenses','point','points','partner','program','optin','exclusive','board','boards','community','resource','resources','deck','decks','card','cards'],
  'Investor & portfolio': ['idea','ideas','innovation','investment','opportunity','opportunities','product','products','feature','features','module','modules'],
  'Identity & tenancy': ['availability','slot','slots','stage','lookup','extension','sessions'],
};
const tokens = n => n.split('_');
function vocabHit(n) {
  const tk = tokens(n);
  let best = null, bestScore = 0;
  for (const [d, words] of Object.entries(VOCAB)) {
    const score = tk.filter(t => words.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore > 0 ? best : null;
}

// PASS 3 — the handful no rule should be bent to fit. Placed explicitly.
const HAND = {
  business_pricing_models: 'Finance',
  creator_youtube_ingests: 'Growth & marketing',
  customer_engagement_feedback_widgets: 'Support & knowledge',
  customer_feedback: 'Support & knowledge',
  inbox_actions: 'Revenue & CRM',
  meeting_transcript_segments: 'Canvas & ideas',
  sign_offs: 'Delivery & work',
  time_entries: 'Delivery & work',
};


module.exports = { DOMAINS, VOCAB, HAND, vocabHit, classify(n){ const pre=DOMAINS.find(([,,re])=>re.test(n)); return HAND[n] || (pre?pre[0]:vocabHit(n)) || null; } };
