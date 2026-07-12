> **PRD** — drafted by Bob Developer (V2 (Container)) · task #384
> _Each agent that updates this PRD signs its change below._

# PRD: Employment Classification Framework

## 1. Problem & Goal

### 1.1. Problem
The current platform lacks a robust employment classification framework beyond a basic `engagement_type` enum. This absence prevents explicit distinction between contractor and FTE statuses and the provision of compliance disclosures for freelancer status. This exposes the platform and its users to significant misclassification risks.

### 1.2. Goal
Implement a comprehensive employment classification framework to explicitly define and assign an employment classification to each engagement. This framework will include surfacing all required compliance disclosures to both parties involved in an engagement, thereby mitigating misclassification risks.

## 2. Target Users / ICP Roles

*   **Clients:** To understand the classification of their engagements and view associated disclosures.
*   **Freelancers / Contractors:** To understand their classification status and view relevant disclosures pertaining to their engagement.
*   **Internal Legal & Compliance Teams:** To define, configure, and audit employment classifications and associated disclosure requirements.
*   **Platform Administrators:** To manage the framework settings and configurations.

## 3. Scope

This project will introduce a new employment classification framework that complements or extends the existing `engagement_type` enum. It will focus on defining, assigning, and disclosing classifications for all *new and active* engagements.

## 4. Functional Requirements

*   **FR1: Classification Definition:** The system shall allow internal Legal & Compliance teams to define and manage a set of distinct employment classifications (e.g., "Full-Time Employee," "Independent Contractor," "Freelancer," "Part-Time Contractor").
*   **FR2: Disclosure Configuration:** For each defined classification, the system shall allow internal teams to configure and associate specific compliance-mandated disclosures. These disclosures may include text, links to legal documents, or specific data points.
*   **FR3: Engagement Classification Assignment:** Each new engagement created shall be explicitly assigned an employment classification from the defined set.
*   **FR4: Classification & Disclosure Display (Client):** Clients shall be able to clearly view the employment classification and all associated compliance disclosures for each of their engagements.
*   **FR5: Classification & Disclosure Display (Freelancer/Contractor):** Freelancers/contractors shall be able to clearly view the employment classification and all associated compliance disclosures for each of their engagements.
*   **FR6: Data Storage:** The assigned classification for each engagement and the status of its associated disclosures (e.g., acknowledgement) shall be persistently stored.

## 5. Acceptance Criteria

*   Every new engagement created within the platform carries an explicit, defined employment classification.
*   For every new and active engagement, all required compliance disclosures pertinent to its assigned classification are prominently surfaced to both the client and the freelancer/contractor.
*   Internal Legal & Compliance teams have the tools to define new classifications and configure/update their associated disclosures.

## 6. Out of Scope

*   Automatic inference or AI-driven assignment of employment classifications. Initial assignment will be manual or rule-based, defined by internal teams.
*   Generation of legal advice; the system will display pre-defined disclosures, not provide real-time legal counsel.
*   Retroactive application of the classification framework to *all* historical, completed engagements. Focus will be on new and active engagements.
*   Detailed UI/UX design specifications.
*   Changes to core platform billing or payment processing logic unless directly necessitated by a disclosure requirement.