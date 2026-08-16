/**
 * Blog data utilities.
 *
 * Blog posts are stored as Markdown files in src/content/blog/.
 * Each file starts with a YAML front-matter block (---…---) followed by the
 * post body in Markdown.
 *
 * Webpack is configured (next.config.js) to import *.md files as raw strings
 * (asset/source), so we can import them statically and parse them at runtime.
 * This is fully compatible with the Cloudflare edge runtime because no
 * filesystem access is required at request time — everything is bundled.
 */

import diagramFormats from '@/content/blog/every-diagram-format-the-canvas-reads.md';
import whichDiagram from '@/content/blog/which-diagram-should-you-draw.md';
import escapeDiagramTool from '@/content/blog/escape-your-diagramming-tool.md';
import gettingStarted from '@/content/blog/getting-started-with-ai-agents.md';
import webgpuLora from '@/content/blog/webgpu-lora-explained.md';
import multiAgent from '@/content/blog/multi-agent-orchestration.md';
import datasetBestPractices from '@/content/blog/ai-dataset-generation-best-practices.md';
import introductionAndOverview from '@/content/blog/introduction-and-overview.md';
import builderforceIntegration from '@/content/blog/builderforce-agents-and-agent-integration.md';
import productIdeation from '@/content/blog/product-ideation-with-builderforce.md';
import approvalGates from '@/content/blog/approval-gates-and-human-oversight.md';
import fleetManagement from '@/content/blog/fleet-management-and-agent-routing.md';
import inBrowserIde from '@/content/blog/in-browser-ide-and-collaboration.md';
import securityMultiTenant from '@/content/blog/security-and-multi-tenant-architecture.md';
import skillsAssignment from '@/content/blog/skills-assignment-and-the-marketplace.md';
import specsAndPlanning from '@/content/blog/specs-and-planning-with-ai.md';
import taskExecution from '@/content/blog/task-execution-and-observability.md';
import autonomousSwimlanes from '@/content/blog/autonomous-swimlane-execution.md';
import semanticCache from '@/content/blog/semantic-response-cache.md';
import bestAiCodingAgents from '@/content/blog/best-ai-coding-agents-compared.md';
import vsCopilot from '@/content/blog/builderforce-vs-github-copilot.md';
import vsCursor from '@/content/blog/builderforce-vs-cursor-windsurf.md';
import vsClaudeCode from '@/content/blog/builderforce-vs-claude-code.md';
import vsDevin from '@/content/blog/builderforce-vs-devin.md';
import systemOfRecord from '@/content/blog/system-of-record-for-agentic-work.md';
import everyRolePicture from '@/content/blog/every-role-operating-picture.md';
import evermind from '@/content/blog/evermind-self-updating-model.md';
import evermindArchitecture from '@/content/blog/inside-evermind-architecture.md';
import agentStack from '@/content/blog/agent-tech-stack-all-seven-layers.md';
import defineANeed from '@/content/blog/define-a-need-the-agentic-system-solves-it.md';
import planningSpine from '@/content/blog/planning-spine-cost-bearing-delivery.md';
import qualityObservability from '@/content/blog/quality-error-observability-one-click-fix.md';
import knowledgeManagement from '@/content/blog/knowledge-management-sops-and-compliance.md';
import boardConnectors from '@/content/blog/single-pane-board-connectors.md';
import agenticTester from '@/content/blog/agentic-tester-autonomous-qa.md';
import agenticWorkforce from '@/content/blog/transitioning-to-an-agentic-workforce.md';
import aiDevMaturity from '@/content/blog/ai-development-maturity-diagnostic.md';
import migrateAndIntegrate from '@/content/blog/migrate-and-integrate-jira-monday-rally-gitlab-bitbucket.md';
import agenticEmployee from '@/content/blog/everything-an-agentic-employee-can-do.md';
import realtimeCollaboration from '@/content/blog/real-time-collaboration-humans-and-agents.md';
import videoMeetings from '@/content/blog/video-meetings-standups-and-shared-calendars.md';
import multiPartyChat from '@/content/blog/multi-party-team-chat-humans-and-agents.md';
import vsCodeCommandCenter from '@/content/blog/vs-code-command-center-for-your-agentic-workforce.md';
import cobitGovernance from '@/content/blog/cobit-governance-readiness-for-agentic-it.md';
import psychometricPersonas from '@/content/blog/ai-agent-personality-psychometric-personas.md';
import incidentManagement from '@/content/blog/incident-management-on-call-and-war-rooms.md';
import roleAccountability from '@/content/blog/role-gated-accountability-proof-of-participation.md';
import rfpResponse from '@/content/blog/automated-rfp-response-from-your-codebase.md';
import memoryFirst from '@/content/blog/memory-first-inference-skip-the-llm.md';
import localFirstWebgpu from '@/content/blog/local-first-ai-webgpu-in-the-browser.md';
import creationCanvasBeyondChat from '@/content/blog/creation-canvas-beyond-chat.md';
import feedbackToMockups from '@/content/blog/customer-feedback-to-ten-mockups.md';
import multiplayerCanvas from '@/content/blog/multiplayer-creation-canvas-web-vscode.md';
import projectComparisonRoadmap from '@/content/blog/compare-projects-and-build-an-executive-roadmap.md';
import evermindCanvas from '@/content/blog/build-and-train-evermind-on-the-creation-canvas.md';
import createBeforeSignup from '@/content/blog/create-before-you-sign-up.md';
import brainCanvasOperator from '@/content/blog/brain-operates-the-creation-canvas.md';
import liveDataStories from '@/content/blog/live-data-stories-on-the-creation-canvas.md';
import designBuildDebug from '@/content/blog/design-build-debug-one-spatial-workspace.md';
import visualTeamRituals from '@/content/blog/visual-team-rituals-humans-and-agents.md';
import canvasReuseVersioning from '@/content/blog/creation-canvas-templates-frames-branches-checkpoints.md';
import creationObjectRegistry from '@/content/blog/forty-eight-live-objects-one-creation-canvas.md';
import llmInteractiveCourse from '@/content/blog/learn-how-to-build-an-llm-interactive-course.md';
import whatsNewAlwaysOnCanvas from '@/content/blog/whats-new-always-on-canvas-workspace.md';
import creationCanvasFunctionalityGuide from '@/content/blog/creation-canvas-functionality-guide.md';
// The methodology set — the arc, the loop, the eight proofs, and the navigation
// that carries them. These four are the written form of what <MethodologySection>
// renders on /features, /about, /pricing and /sell-builderforce.
import ideaToRealMethodology from '@/content/blog/idea-to-real-the-operating-methodology.md';
import eightWaysToMakeItReal from '@/content/blog/eight-ways-to-make-an-idea-real.md';
import readProveBuild from '@/content/blog/read-prove-build-the-inner-loop.md';
import menuAsMethodology from '@/content/blog/idea-make-run-measure-menu-as-methodology.md';

// The hired.video article corpus, ported wholesale when hired.video was
// absorbed into Builderforce (PRD 18). Slugs are preserved 1:1 so
// hired.video/blog/<slug> redirects to builderforce.ai/blog/<slug> without
// losing link equity.
import howToScoreYourResumeForAts from '@/content/blog/how-to-score-your-resume-for-ats.md';
import optimizeYourResumeForAnyJob from '@/content/blog/optimize-your-resume-for-any-job.md';
import howToResearchYourMarketSalary from '@/content/blog/how-to-research-your-market-salary.md';
import howToMatchYourResumeToAnyJob from '@/content/blog/how-to-match-your-resume-to-any-job.md';
import completeGuideToVideoResumes from '@/content/blog/complete-guide-to-video-resumes.md';
import tailorYourResumeForEveryApplication from '@/content/blog/tailor-your-resume-for-every-application.md';
import writeAConfidentResumeToneGuide from '@/content/blog/write-a-confident-resume-tone-guide.md';
import howToWriteYourPersonalValueProposition from '@/content/blog/how-to-write-your-personal-value-proposition.md';
import mergeMultipleResumesIntoOne from '@/content/blog/merge-multiple-resumes-into-one.md';
import writeAProfessionalSummaryThatGetsNoticed from '@/content/blog/write-a-professional-summary-that-gets-noticed.md';
import parseResumePdfToStructuredJson from '@/content/blog/parse-resume-pdf-to-structured-json.md';
import howToPrepareForAnyJobInterview from '@/content/blog/how-to-prepare-for-any-job-interview.md';
import howToChooseTheRightResumeTemplate from '@/content/blog/how-to-choose-the-right-resume-template.md';
import bestResumeTemplateForFinanceAndPayroll from '@/content/blog/best-resume-template-for-finance-and-payroll.md';
import bestResumeTemplateForConsultingAndRisk from '@/content/blog/best-resume-template-for-consulting-and-risk.md';
import bestResumeTemplateForExecutivesAndCSuite from '@/content/blog/best-resume-template-for-executives-and-c-suite.md';
import bestResumeTemplateForNewGradsAndInterns from '@/content/blog/best-resume-template-for-new-grads-and-interns.md';
import bestResumeTemplateForHospitalityAndRetail from '@/content/blog/best-resume-template-for-hospitality-and-retail.md';
import bestResumeTemplateForDesignersAndCreatives from '@/content/blog/best-resume-template-for-designers-and-creatives.md';
import bestResumeTemplateForSoftwareEngineers from '@/content/blog/best-resume-template-for-software-engineers.md';
import bestResumeTemplateForNursesAndHealthcare from '@/content/blog/best-resume-template-for-nurses-and-healthcare.md';
import bestResumeTemplateForSalesAndBusinessDevelopment from '@/content/blog/best-resume-template-for-sales-and-business-development.md';
import whatMakesAStandoutCandidateProfile from '@/content/blog/what-makes-a-standout-candidate-profile.md';
import videoResumeExamplesThatLandInterviews from '@/content/blog/video-resume-examples-that-land-interviews.md';
import researchEmployersWithReviewsAndSalaryData from '@/content/blog/research-employers-with-reviews-and-salary-data.md';
import aiRecruiterAgentSource50CandidatesIn5Minutes from '@/content/blog/ai-recruiter-agent-source-50-candidates-in-5-minutes.md';
import runALiveScreeningBlockIn30Minutes from '@/content/blog/run-a-live-screening-block-in-30-minutes.md';
import hiredVideoVsLinkedinRecruiter2026Comparison from '@/content/blog/hired-video-vs-linkedin-recruiter-2026-comparison.md';
import hiredVideoVsIndeedWhenToUseEach from '@/content/blog/hired-video-vs-indeed-when-to-use-each.md';
import hiredVideoVsZiprecruiterPricingAiVideoScreening from '@/content/blog/hired-video-vs-ziprecruiter-pricing-ai-video-screening.md';
import hiredVideoVsGlassdoorReviewsSalaryEmployerBranding from '@/content/blog/hired-video-vs-glassdoor-reviews-salary-employer-branding.md';
import howToMakeAPodcastEpisodeInHiredVideoStudio from '@/content/blog/how-to-make-a-podcast-episode-in-hired-video-studio.md';
import howToMakeAnAnimatedComicResumeInHiredVideoStudio from '@/content/blog/how-to-make-an-animated-comic-resume-in-hired-video-studio.md';
import howToBuildA3dWorldResumeInHiredVideoStudio from '@/content/blog/how-to-build-a-3d-world-resume-in-hired-video-studio.md';
import howToMakeAVideoResumeInHiredVideoStudio from '@/content/blog/how-to-make-a-video-resume-in-hired-video-studio.md';
import howToLaunchACourseAndUploadScormOnHiredVideo from '@/content/blog/how-to-launch-a-course-and-upload-scorm-on-hired-video.md';
import howToRunAClassroomCohortAsAnEducator from '@/content/blog/how-to-run-a-classroom-cohort-as-an-educator.md';
import howToEarnAVerifiableCertificateOnHiredVideo from '@/content/blog/how-to-earn-a-verifiable-certificate-on-hired-video.md';
import howToRunTakeHomeAssignmentsWithoutLosingCandidates from '@/content/blog/how-to-run-take-home-assignments-without-losing-candidates.md';
import structuredScorecardsAndBlindReviewToReduceHiringBias from '@/content/blog/structured-scorecards-and-blind-review-to-reduce-hiring-bias.md';
import retainedVsContingencySearchAndThePowerOfWarmIntros from '@/content/blog/retained-vs-contingency-search-and-the-power-of-warm-intros.md';
import howToRunEffectiveOneOnOnes from '@/content/blog/how-to-run-effective-one-on-ones.md';
import howToBuildAnOrgChartThatStaysAccurate from '@/content/blog/how-to-build-an-org-chart-that-stays-accurate.md';
import teamHealthSignalsEveryManagerShouldWatch from '@/content/blog/team-health-signals-every-manager-should-watch.md';
import howToHostAHiringEventOnHiredVideo from '@/content/blog/how-to-host-a-hiring-event-on-hired-video.md';
import howToBookACoachingSessionOnHiredVideo from '@/content/blog/how-to-book-a-coaching-session-on-hired-video.md';
import howToLeaveACompanyReviewThatHelps from '@/content/blog/how-to-leave-a-company-review-that-helps.md';
import howToAskForAReferenceAndShareIt from '@/content/blog/how-to-ask-for-a-reference-and-share-it.md';
import buildACareerRoadmapWithAi from '@/content/blog/build-a-career-roadmap-with-ai.md';
import extractSkillsFromAnyJobOrResume from '@/content/blog/extract-skills-from-any-job-or-resume.md';
import syncYourResumeEverywhereWithoutCopyPaste from '@/content/blog/sync-your-resume-everywhere-without-copy-paste.md';
import addAiVoiceoverToYourVideoResume from '@/content/blog/add-ai-voiceover-to-your-video-resume.md';
import turnYourReferencesIntoAJobWinningAsset from '@/content/blog/turn-your-references-into-a-job-winning-asset.md';
import earnVerifiableCertificatesAndLevelUpYourCareer from '@/content/blog/earn-verifiable-certificates-and-level-up-your-career.md';
import sendHiringManagersABiasFreeCandidatePacket from '@/content/blog/send-hiring-managers-a-bias-free-candidate-packet.md';
import hireAssignAndPayForWorkInOnePlace from '@/content/blog/hire-assign-and-pay-for-work-in-one-place.md';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  description: string;
  tags: string[];
  author: string;
  content: string;
}

/** Parse a YAML front-matter block and return metadata + body. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta, body: raw };

  const [, frontmatter, body] = match;
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body };
}

/** Parse a YAML array like `[a, b, c]` or `- a\n- b` into a string array. */
function parseYamlArray(value: string): string[] {
  if (!value) return [];
  // Inline array: [tag1, tag2]
  const inlineMatch = value.match(/^\[(.*)\]$/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Multi-line block arrays aren't used in these files; return as single tag.
  return [value];
}

function buildPost(slug: string, raw: string): BlogPost {
  const { meta, body } = parseFrontmatter(raw);
  // Strip the leading `# Title` H1 that duplicates the page title shown above
  // the content. Only removes a single top-level ATX heading (# followed by a
  // space), not ##/### subheadings.
  const cleanBody = body.trim().replace(/^# [^\n]*\n?/, '').trim();
  return {
    slug,
    title: meta.title ?? slug,
    date: meta.date ?? '',
    description: meta.description ?? '',
    tags: parseYamlArray(meta.tags ?? ''),
    author: meta.author ?? '',
    content: cleanBody,
  };
}

/** All published blog posts, sorted newest-first. */
export const BLOG_POSTS: BlogPost[] = [
  buildPost('idea-to-real-the-operating-methodology', ideaToRealMethodology),
  buildPost('eight-ways-to-make-an-idea-real', eightWaysToMakeItReal),
  buildPost('read-prove-build-the-inner-loop', readProveBuild),
  buildPost('idea-make-run-measure-menu-as-methodology', menuAsMethodology),
  buildPost('every-diagram-format-the-canvas-reads', diagramFormats),
  buildPost('which-diagram-should-you-draw', whichDiagram),
  buildPost('escape-your-diagramming-tool', escapeDiagramTool),
  buildPost('whats-new-always-on-canvas-workspace', whatsNewAlwaysOnCanvas),
  buildPost('creation-canvas-functionality-guide', creationCanvasFunctionalityGuide),
  buildPost('learn-how-to-build-an-llm-interactive-course', llmInteractiveCourse),
  buildPost('create-before-you-sign-up', createBeforeSignup),
  buildPost('brain-operates-the-creation-canvas', brainCanvasOperator),
  buildPost('live-data-stories-on-the-creation-canvas', liveDataStories),
  buildPost('design-build-debug-one-spatial-workspace', designBuildDebug),
  buildPost('visual-team-rituals-humans-and-agents', visualTeamRituals),
  buildPost('creation-canvas-templates-frames-branches-checkpoints', canvasReuseVersioning),
  buildPost('forty-eight-live-objects-one-creation-canvas', creationObjectRegistry),
  buildPost('creation-canvas-beyond-chat', creationCanvasBeyondChat),
  buildPost('customer-feedback-to-ten-mockups', feedbackToMockups),
  buildPost('multiplayer-creation-canvas-web-vscode', multiplayerCanvas),
  buildPost('compare-projects-and-build-an-executive-roadmap', projectComparisonRoadmap),
  buildPost('build-and-train-evermind-on-the-creation-canvas', evermindCanvas),
  buildPost('getting-started-with-ai-agents', gettingStarted),
  buildPost('webgpu-lora-explained', webgpuLora),
  buildPost('multi-agent-orchestration', multiAgent),
  buildPost('ai-dataset-generation-best-practices', datasetBestPractices),
  buildPost('introduction-and-overview', introductionAndOverview),
  // Slug aligned to its filename (was 'builderforce-and-agent-integration', a
  // divergence from the source file). The old slug was only referenced here, so
  // no published URL breaks — the sitemap and routes derive from this array.
  buildPost('builderforce-agents-and-agent-integration', builderforceIntegration),
  buildPost('product-ideation-with-builderforce', productIdeation),
  buildPost('approval-gates-and-human-oversight', approvalGates),
  buildPost('fleet-management-and-agent-routing', fleetManagement),
  buildPost('in-browser-ide-and-collaboration', inBrowserIde),
  buildPost('security-and-multi-tenant-architecture', securityMultiTenant),
  buildPost('skills-assignment-and-the-marketplace', skillsAssignment),
  buildPost('specs-and-planning-with-ai', specsAndPlanning),
  buildPost('task-execution-and-observability', taskExecution),
  buildPost('autonomous-swimlane-execution', autonomousSwimlanes),
  buildPost('semantic-response-cache', semanticCache),
  buildPost('best-ai-coding-agents-compared', bestAiCodingAgents),
  buildPost('builderforce-vs-github-copilot', vsCopilot),
  buildPost('builderforce-vs-cursor-windsurf', vsCursor),
  buildPost('builderforce-vs-claude-code', vsClaudeCode),
  buildPost('builderforce-vs-devin', vsDevin),
  buildPost('system-of-record-for-agentic-work', systemOfRecord),
  buildPost('every-role-operating-picture', everyRolePicture),
  buildPost('evermind-self-updating-model', evermind),
  buildPost('inside-evermind-architecture', evermindArchitecture),
  buildPost('agent-tech-stack-all-seven-layers', agentStack),
  buildPost('define-a-need-the-agentic-system-solves-it', defineANeed),
  buildPost('planning-spine-cost-bearing-delivery', planningSpine),
  buildPost('quality-error-observability-one-click-fix', qualityObservability),
  buildPost('knowledge-management-sops-and-compliance', knowledgeManagement),
  buildPost('single-pane-board-connectors', boardConnectors),
  buildPost('agentic-tester-autonomous-qa', agenticTester),
  buildPost('transitioning-to-an-agentic-workforce', agenticWorkforce),
  buildPost('ai-development-maturity-diagnostic', aiDevMaturity),
  buildPost('migrate-and-integrate-jira-monday-rally-gitlab-bitbucket', migrateAndIntegrate),
  buildPost('everything-an-agentic-employee-can-do', agenticEmployee),
  buildPost('real-time-collaboration-humans-and-agents', realtimeCollaboration),
  buildPost('video-meetings-standups-and-shared-calendars', videoMeetings),
  buildPost('multi-party-team-chat-humans-and-agents', multiPartyChat),
  buildPost('vs-code-command-center-for-your-agentic-workforce', vsCodeCommandCenter),
  buildPost('cobit-governance-readiness-for-agentic-it', cobitGovernance),
  buildPost('ai-agent-personality-psychometric-personas', psychometricPersonas),
  buildPost('incident-management-on-call-and-war-rooms', incidentManagement),
  buildPost('role-gated-accountability-proof-of-participation', roleAccountability),
  buildPost('automated-rfp-response-from-your-codebase', rfpResponse),
  buildPost('memory-first-inference-skip-the-llm', memoryFirst),
  buildPost('local-first-ai-webgpu-in-the-browser', localFirstWebgpu),
  // ── Ported hired.video corpus ──────────────────────────────────────────
  buildPost('how-to-score-your-resume-for-ats', howToScoreYourResumeForAts),
  buildPost('optimize-your-resume-for-any-job', optimizeYourResumeForAnyJob),
  buildPost('how-to-research-your-market-salary', howToResearchYourMarketSalary),
  buildPost('how-to-match-your-resume-to-any-job', howToMatchYourResumeToAnyJob),
  buildPost('complete-guide-to-video-resumes', completeGuideToVideoResumes),
  buildPost('tailor-your-resume-for-every-application', tailorYourResumeForEveryApplication),
  buildPost('write-a-confident-resume-tone-guide', writeAConfidentResumeToneGuide),
  buildPost('how-to-write-your-personal-value-proposition', howToWriteYourPersonalValueProposition),
  buildPost('merge-multiple-resumes-into-one', mergeMultipleResumesIntoOne),
  buildPost('write-a-professional-summary-that-gets-noticed', writeAProfessionalSummaryThatGetsNoticed),
  buildPost('parse-resume-pdf-to-structured-json', parseResumePdfToStructuredJson),
  buildPost('how-to-prepare-for-any-job-interview', howToPrepareForAnyJobInterview),
  buildPost('how-to-choose-the-right-resume-template', howToChooseTheRightResumeTemplate),
  buildPost('best-resume-template-for-finance-and-payroll', bestResumeTemplateForFinanceAndPayroll),
  buildPost('best-resume-template-for-consulting-and-risk', bestResumeTemplateForConsultingAndRisk),
  buildPost('best-resume-template-for-executives-and-c-suite', bestResumeTemplateForExecutivesAndCSuite),
  buildPost('best-resume-template-for-new-grads-and-interns', bestResumeTemplateForNewGradsAndInterns),
  buildPost('best-resume-template-for-hospitality-and-retail', bestResumeTemplateForHospitalityAndRetail),
  buildPost('best-resume-template-for-designers-and-creatives', bestResumeTemplateForDesignersAndCreatives),
  buildPost('best-resume-template-for-software-engineers', bestResumeTemplateForSoftwareEngineers),
  buildPost('best-resume-template-for-nurses-and-healthcare', bestResumeTemplateForNursesAndHealthcare),
  buildPost('best-resume-template-for-sales-and-business-development', bestResumeTemplateForSalesAndBusinessDevelopment),
  buildPost('what-makes-a-standout-candidate-profile', whatMakesAStandoutCandidateProfile),
  buildPost('video-resume-examples-that-land-interviews', videoResumeExamplesThatLandInterviews),
  buildPost('research-employers-with-reviews-and-salary-data', researchEmployersWithReviewsAndSalaryData),
  buildPost('ai-recruiter-agent-source-50-candidates-in-5-minutes', aiRecruiterAgentSource50CandidatesIn5Minutes),
  buildPost('run-a-live-screening-block-in-30-minutes', runALiveScreeningBlockIn30Minutes),
  buildPost('hired-video-vs-linkedin-recruiter-2026-comparison', hiredVideoVsLinkedinRecruiter2026Comparison),
  buildPost('hired-video-vs-indeed-when-to-use-each', hiredVideoVsIndeedWhenToUseEach),
  buildPost('hired-video-vs-ziprecruiter-pricing-ai-video-screening', hiredVideoVsZiprecruiterPricingAiVideoScreening),
  buildPost('hired-video-vs-glassdoor-reviews-salary-employer-branding', hiredVideoVsGlassdoorReviewsSalaryEmployerBranding),
  buildPost('how-to-make-a-podcast-episode-in-hired-video-studio', howToMakeAPodcastEpisodeInHiredVideoStudio),
  buildPost('how-to-make-an-animated-comic-resume-in-hired-video-studio', howToMakeAnAnimatedComicResumeInHiredVideoStudio),
  buildPost('how-to-build-a-3d-world-resume-in-hired-video-studio', howToBuildA3dWorldResumeInHiredVideoStudio),
  buildPost('how-to-make-a-video-resume-in-hired-video-studio', howToMakeAVideoResumeInHiredVideoStudio),
  buildPost('how-to-launch-a-course-and-upload-scorm-on-hired-video', howToLaunchACourseAndUploadScormOnHiredVideo),
  buildPost('how-to-run-a-classroom-cohort-as-an-educator', howToRunAClassroomCohortAsAnEducator),
  buildPost('how-to-earn-a-verifiable-certificate-on-hired-video', howToEarnAVerifiableCertificateOnHiredVideo),
  buildPost('how-to-run-take-home-assignments-without-losing-candidates', howToRunTakeHomeAssignmentsWithoutLosingCandidates),
  buildPost('structured-scorecards-and-blind-review-to-reduce-hiring-bias', structuredScorecardsAndBlindReviewToReduceHiringBias),
  buildPost('retained-vs-contingency-search-and-the-power-of-warm-intros', retainedVsContingencySearchAndThePowerOfWarmIntros),
  buildPost('how-to-run-effective-one-on-ones', howToRunEffectiveOneOnOnes),
  buildPost('how-to-build-an-org-chart-that-stays-accurate', howToBuildAnOrgChartThatStaysAccurate),
  buildPost('team-health-signals-every-manager-should-watch', teamHealthSignalsEveryManagerShouldWatch),
  buildPost('how-to-host-a-hiring-event-on-hired-video', howToHostAHiringEventOnHiredVideo),
  buildPost('how-to-book-a-coaching-session-on-hired-video', howToBookACoachingSessionOnHiredVideo),
  buildPost('how-to-leave-a-company-review-that-helps', howToLeaveACompanyReviewThatHelps),
  buildPost('how-to-ask-for-a-reference-and-share-it', howToAskForAReferenceAndShareIt),
  buildPost('build-a-career-roadmap-with-ai', buildACareerRoadmapWithAi),
  buildPost('extract-skills-from-any-job-or-resume', extractSkillsFromAnyJobOrResume),
  buildPost('sync-your-resume-everywhere-without-copy-paste', syncYourResumeEverywhereWithoutCopyPaste),
  buildPost('add-ai-voiceover-to-your-video-resume', addAiVoiceoverToYourVideoResume),
  buildPost('turn-your-references-into-a-job-winning-asset', turnYourReferencesIntoAJobWinningAsset),
  buildPost('earn-verifiable-certificates-and-level-up-your-career', earnVerifiableCertificatesAndLevelUpYourCareer),
  buildPost('send-hiring-managers-a-bias-free-candidate-packet', sendHiringManagersABiasFreeCandidatePacket),
  buildPost('hire-assign-and-pay-for-work-in-one-place', hireAssignAndPayForWorkInOnePlace),
].sort((a, b) => (a.date < b.date ? 1 : -1));

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/**
 * Resolve an explicit, ordered list of slugs to their posts (missing slugs are
 * skipped). Used to attach curated "related reading" to marketing surfaces via
 * the RELATED_ARTICLES map in content.ts — single source of truth for which
 * articles back which page.
 */
export function getPostsBySlugs(slugs: string[]): BlogPost[] {
  return slugs.map((s) => getPostBySlug(s)).filter((p): p is BlogPost => Boolean(p));
}

/**
 * Find posts related to a given post by shared tags, newest-first, excluding the
 * post itself. Powers the "Related articles" block at the foot of each blog post
 * without hand-maintaining a per-post list.
 */
export function getRelatedByTags(slug: string, limit = 3): BlogPost[] {
  const post = getPostBySlug(slug);
  if (!post) return [];
  const tags = new Set(post.tags);
  return BLOG_POSTS.filter((p) => p.slug !== slug)
    .map((p) => ({ post: p, overlap: p.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => (b.overlap - a.overlap) || (a.post.date < b.post.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.post);
}
