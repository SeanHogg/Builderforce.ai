/**
 * PRD Analysis Workflow definition
 * 
 * A pre-defined workflow template specifically designed for automated PRD analysis.
 * Parses PRD text, identifies dependencies, performs consistency checks, and produces
 * structured analysis outputs for downstream use. Supports policy-driven extensions
 * (e.g., Impact Analysis for large PRDs).
 */

import type { WorkflowStep } from "./orchestrator.js";

/**
 * PRD analysis scope threshold for triggering an Impact Analysis task (AC.3).
 * PRDs larger than this many characters require an Impact Analysis step.
 */
export const PRD_IMPACT_ANALYSIS_THRESHOLD = 20_000;

/**
 * PRD Analysis Workflow
 * 
 * Four-phase analysis:
 *   1. Parse PRD — Extract structure, sections, requirements
 *   2. Identify Dependencies — Map feature requirements to other systems
 *   3. Flag Missing Sections — Check for required PRD elements
 *   4. Generate Summary & Recommendations — Produce analysis report
 * 
 * Supports policy-driven extension: if PRD exceeds PRD_IMPACT_ANALYSIS_THRESHOLD,
 * an optional "impact-analysis" step is inserted after parsing.
 * 
 * @param prdText - Full PRD content to analyze
 * @param requireImpactAnalysis - Whether to enforce Impact Analysis step
 * @returns Ordered list of workflow steps
 */
export function createPrdAnalysisWorkflow(
  prdText: string,
  requireImpactAnalysis = false,
): WorkflowStep[] {
  const scope = prdText.length;
  const shouldRequireAnalysis = requireImpactAnalysis || scope > PRD_IMPACT_ANALYSIS_THRESHOLD;

  const steps: WorkflowStep[] = [
    {
      role: "architecture-advisor",
      task: "Parse the Product Requirements Document and extract its structure, sections, and key requirements. Produce a structured outline of the PRD content.",
    },
    {
      role: "code-creator",
      task: "Identify and map feature requirements to their dependencies on other systems, components, or third-party services. Produce a dependency graph and list of external integrations.",
      dependsOn: [
        "Parse the Product Requirements Document and extract its structure, sections, and key requirements. Produce a structured outline of the PRD content.",
      ],
    },
    {
      role: "code-reviewer",
      task: "Flag any missing or incomplete sections in the PRD (e.g., missing requirements, undefined success criteria, undefined exit criteria) and produce a checklist of items to address.",
      dependsOn: [
        "Parse the Product Requirements Document and extract its structure, sections, and key requirements. Produce a structured outline of the PRD content.",
      ],
    },
    {
      role: "architecture-advisor",
      task: "Generate a comprehensive PRD analysis summary including: key requirements, identified risks, dependency concerns, missing sections, and actionable recommendations. Structure the response as a markdown report.",
      dependsOn: [
        "Identify and map feature requirements to their dependencies on other systems, components, or third-party services. Produce a dependency graph and list of external integrations.",
        "Flag any missing or incomplete sections in the PRD and produce a checklist of items to address.",
      ],
    },
  ];

  // Policy-driven extension: add Impact Analysis task for large PRDs (AC.3)
  if (shouldRequireAnalysis) {
    steps.unshift({
      role: "architecture-advisor",
      task: `Perform an Impact Analysis for this PRD, which is approaching ${scope.toLocaleString()} characters. Identify cross-functional impacts, data flows, security implications, performance considerations, and potential downstream effects across different teams or services.`,
      dependsOn: [
        "Parse the Product Requirements Document and extract its structure, sections, and key requirements. Produce a structured outline of the PRD content.",
      ],
    });
  }

  return steps;
}

/**
 * Parse a PRD Analysis Report to extract structured findings
 * 
 * @param analysisOutput - The output from the Architecture Advisor's analysis step
 * @returns Structured PRD analysis results
 */
export interface PrdAnalysisResult {
  sections: string[];
  requirements: string[];
  dependencies: string[];
  missingSections: string[];
  risks: string[];
  recommendations: string[];
  taggedScope: "small" | "medium" | "large";
  hasImpactAnalysis: boolean;
}

export function parsePrdAnalysisReport(analysisOutput: string): PrdAnalysisResult {
  const result: PrdAnalysisResult = {
    sections: [],
    requirements: [],
    dependencies: [],
    missingSections: [],
    risks: [],
    recommendations: [],
    taggedScope: "small",
    hasImpactAnalysis: false,
  };

  // Simple parser to extract sections from markdown report
  const sections = [
    { name: "## Key Requirements", key: "requirements" },
    { name: "## Dependencies", key: "dependencies" },
    { name: "## Missing Sections", key: "missingSections" },
    { name: "## Risks", key: "risks" },
    { name: "## Recommendations", key: "recommendations" },
  ];

  let currentSection = "";
  for (const line of analysisOutput.split("\n")) {
    const trimmed = line.trim();

    // Check for section headers
    for (const { name, key } of sections) {
      if (trimmed === name) {
        currentSection = key;
        result[key] = [];
        continue;
      }
    }

    // Collect content under current section
    if (currentSection && advancedTrim(trimmed) && !trimmed.startsWith("#") && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      result[currentSection]?.push(trimmed);
    }
  }

  // Tag scope based on original PRD length
  if (analysisOutput.length >= 40_000) {
    result.taggedScope = "large";
  } else if (analysisOutput.length >= PRD_IMPACT_ANALYSIS_THRESHOLD) {
    result.taggedScope = "medium";
  } else {
    result.taggedScope = "small";
  }

  // Check if impact analysis was performed
  result.hasImpactAnalysis = analysisOutput.includes("Impact Analysis") || analysisOutput.toLowerCase().includes("cross-functional impact");

  return result;
}

function advancedTrim(str: string): boolean {
  return str.split(/\s+/).join("") !== "";
}