> **PRD** — drafted by Ada (Sr. Product Mgr) · task #154
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Onboarding Wizard UX

## Problem & Goal

**Problem:** New and existing PMs/leaders lack a streamlined, guided experience to connect their tools, ingest project data, understand project health, and receive actionable resolution plans within the platform. The current process is manual and disconnected, leading to friction and delayed time-to-value.

**Goal:** To provide a seamless, guided, and AI-assisted onboarding wizard that enables PMs/leaders to quickly set up a project, connect relevant integrations, ingest data, diagnose project health, and generate an actionable resolution and resource plan, all within a single, resumable flow.

## Target Users / ICP Roles

*   **PM/Leader:** Individuals responsible for project oversight, team management, strategic planning, and delivery outcomes.

## Scope

The scope covers the implementation of an end-to-end, multi-step onboarding wizard designed to guide users from initial project setup through to a comprehensive project health and resolution plan. The wizard will be characterized by its resumability, progressive disclosure of information, actionable outputs, and integrated AI assistance.

## Functional Requirements

The onboarding wizard shall provide the following core functionality:

1.  **Welcome & Project Setup (Step 1)**
    *   Allow users to input Project Name, Description, associate a Team, and define Key Deadlines.
2.  **Integration Connection (Step 2)**
    *   Provide guided setup for critical integrations: GitHub, Jira, Slack, CI/CD tools, Monitoring solutions.
    *   Include real-time validation to confirm successful connection and data flow for each integration.
3.  **Data Ingestion (Step 3)**
    *   Trigger initial data synchronization from connected integrations.
    *   Display progress of data ingestion and identify any data gaps or missing information.
4.  **Diagnostic Interview (Step 4)**
    *   Present a structured interview with questions regarding project status, risks, and priorities (leveraging inputs from US-1).
    *   Support AI assistance for answering questions, suggesting options, and filling gaps.
5.  **Health Assessment (Step 5)**
    *   Automatically generate a comprehensive project health scorecard based on ingested data and diagnostic input (leveraging outputs from US-3).
6.  **Resolution Plan (Step 6)**
    *   Provide AI-generated recommendations for addressing identified health issues and risks (leveraging outputs from US-5).
7.  **Resource Plan (Step 7)**
    *   Generate capacity and cost estimates associated with the proposed resolution plan (leveraging outputs from US-6).
8.  **Next Steps (Step 8)**
    *   Present a prioritized list of actionable steps.
    *   Include a one-click "Accept and Execute" option to initiate the proposed plan.
9.  **Resumability:** Allow users to save their progress at any point and resume the onboarding flow later.
10. **Progressive Disclosure:** Reveal subsequent steps or information as preceding data becomes available or complete.
11. **Actionable Outputs:** Ensure every step culminates in a tangible output or moves the user closer to the final deliverables.
12. **AI Assistance:** Integrate AI agent capabilities throughout the flow to assist with suggestions, auto-filling information, and detecting data gaps.
13. **Quick Start Mode:** Provide an option for experienced users to skip directly to the Diagnostic Interview (Step 4).

## Acceptance Criteria

*   The end-to-end onboarding wizard, comprising all 8 defined steps, is fully functional.
*   Users can save their progress and resume the onboarding flow from their last completed step.
*   Integration connection validation is performed and clearly communicated at each relevant integration step.
*   AI assistance (suggestions, auto-fill, gap detection) is visibly integrated and helpful throughout the wizard.
*   Upon completion, the wizard successfully generates and presents a Project Health Report, a Resolution Plan, and a Resource Plan.
*   The "Quick Start" mode correctly allows users to bypass initial steps and proceed directly to the Diagnostic Interview.

## Out of Scope

*   Detailed implementation specifics of US-1 (Diagnostic Interview questions), US-3 (Health Scorecard generation logic), US-5 (AI recommendation engine), and US-6 (Capacity & cost estimation algorithms) beyond their integration points within the wizard.
*   Full-fledged project management features (e.g., task assignment, detailed tracking) beyond the "Accept and Execute" trigger.
*   User customization of the onboarding flow (e.g., adding/removing custom steps).
*   Deep integration with external billing systems for resource cost estimation (focus is on internal estimates).