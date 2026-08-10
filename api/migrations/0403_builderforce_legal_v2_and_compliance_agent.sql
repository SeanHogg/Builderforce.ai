-- Publish the first complete BuilderForce.ai legal set and provision the
-- chat-addressable Compliance Audit Agent for every existing tenant.
--
-- This is a material policy release (1.0.0 -> 2.1.0), so Terms acceptance is
-- intentionally invalidated by the new active version. The application fallback
-- carries the same version and full-form subject matter for fresh environments.

UPDATE legal_documents
SET is_active = false, updated_at = NOW()
WHERE document_type IN ('terms', 'privacy') AND is_active = true;

INSERT INTO legal_documents (document_type, version, title, content, is_active, published_at)
VALUES (
  'terms',
  '2.1.0',
  'Terms of Use for BuilderForce.ai',
  $terms$# Terms of Use for BuilderForce.ai

**Effective Date:** August 4, 2026  
**Version:** 2.1.0

These Terms of Use (the **Terms**) are an agreement between you and Fix Faster LLC, a Michigan limited liability company doing business as BuilderForce.ai (**BuilderForce**, **we**, **us**, or **our**). They govern your use of BuilderForce.ai, its websites, applications, APIs, hosted agent runtime, integrations, and related services (the **Service**). By accepting these Terms or using the Service, you agree to them. If you act for an organization, you represent that you may bind it.

## 1. Eligibility and Accounts

You must be at least 18 and able to enter this agreement. The Service is for business and professional use and is not directed to children under 13. Provide accurate information, protect credentials and API keys, use reasonable security controls, and notify security@builderforce.ai of suspected unauthorized access. You are responsible for activity under your account and for user, agent, repository, integration, and approval permissions.

## 2. Agentic Operation

At your direction, software agents may analyze repositories and connected sources, generate or modify code and content, call tools, communicate with third-party systems, and create tickets or pull requests. Agent output is probabilistic and may be inaccurate, incomplete, insecure, or unsuitable.

You are responsible for reviewing outputs, maintaining backups and version control, setting permission and approval gates, and applying qualified human review before deployment or use in legal, medical, financial, employment, housing, credit, insurance, safety-critical, or other consequential decisions. BuilderForce does not provide professional advice or guarantee that agent output is correct, compliant, non-infringing, secure, or fit for production.

## 3. Your Content, Chats, Code, and Ideas

As between you and BuilderForce, you retain all right, title, and interest in prompts, chat history, ideas, requirements, files, source code, repository content, datasets, credentials, and other materials you or your authorized users submit (**Customer Content**). BuilderForce does not acquire ownership merely because you use the Service.

You grant BuilderForce a limited, non-exclusive, worldwide license to host, copy, transmit, display, process, and technically transform Customer Content only as necessary to provide, secure, support, and maintain the Service; follow your instructions; prevent abuse; and comply with law. This license ends when the relevant content is deleted, subject to reasonable backup cycles, legal obligations, and the Privacy Policy.

We do not sell Customer Content, chat history, or ideas. We do not use Customer Content to train generalized AI models for other customers unless you separately and expressly opt in. Feedback about BuilderForce itself may be used without identifying you or disclosing confidential information.

You represent that you have the rights and permissions needed for Customer Content and your instructions. Do not submit regulated or sensitive data unless processing is lawful and supported by appropriate contractual and technical safeguards.

## 4. Generated Output

Subject to applicable law and third-party rights, as between you and BuilderForce, you own output generated specifically for you from Customer Content. Output may not be unique. Your ownership does not extend to BuilderForce technology, third-party materials, open-source components, or another customer's output. You are responsible for validating output, security, licenses, attribution, and compliance. Where law does not recognize ownership of machine-generated material, BuilderForce assigns to you any rights it may have, excluding BuilderForce technology and third-party materials.

## 5. BuilderForce Technology

BuilderForce and its licensors retain all rights in the Service, software, designs, models, orchestration, documentation, trademarks, and aggregate or de-identified operational information that cannot reasonably identify you or reconstruct Customer Content. Except as allowed, you may not copy, resell, lease, reverse engineer, bypass controls, or systematically extract the Service to build a competing service. Open-source components remain governed by their licenses.

## 6. Acceptable Use

You may not use the Service to violate law, sanctions, privacy or intellectual-property rights; create malware, fraud, unlawful surveillance, spam, deceptive impersonation, or material harm; access systems or data without authorization; bypass security, approvals, or limits; make prohibited solely automated consequential decisions; process children's or sensitive data without required authority and consent; or interfere with the Service. We may investigate misuse and limit or suspend access to protect users, third parties, or the Service.

## 7. Third-Party Services

The Service may connect to model providers, Git hosting, cloud platforms, messaging, payments, and other third parties selected by you or used as subprocessors. Enabling an integration directs us to transmit information necessary for your request. Third-party services are governed by their own terms. You are responsible for credentials, licenses, fees, limits, and permissions. We may disable an integration posing security, legal, or operational risk. A current subprocessor list should be available through our website or on request.

## 8. Confidentiality

Each party will use the other's confidential information only under these Terms, protect it with reasonable care, and disclose it only to people and providers who need it and must protect it. These duties exclude information lawfully public, previously known, independently developed, or obtained without restriction. Required disclosures may be made after notice when legally permitted.

## 9. Privacy and Data Processing

Our Privacy Policy explains our handling of personal information. For Customer Content, the business customer generally acts as controller or business and BuilderForce as processor or service provider. A Data Processing Addendum with appropriate transfer terms should be available to covered customers on request. You are responsible for notices, consents, rights handling, and lawful configuration.

## 10. Fees

Paid plans, usage, credits, limits, renewals, and cancellations are shown at purchase or in an order form. Unless stated otherwise, subscriptions renew until canceled before renewal. You authorize charges and are responsible for applicable taxes. Fees are nonrefundable except where required or expressly stated. Future price changes apply at renewal after advance notice.

## 11. Suspension and Termination

You may stop using the Service and close your account, subject to payment and administrator controls. We may suspend or terminate for material breach, unlawful or dangerous use, security risk, nonpayment, or legal requirement, with notice and an opportunity to cure when practicable. On termination, export Customer Content promptly. Ownership, confidentiality, payment, disclaimers, liability, indemnity, and dispute provisions survive.

## 12. Disclaimers

Except for an express order-form warranty, the Service and output are provided **as is** and **as available**. To the maximum extent permitted, BuilderForce disclaims implied warranties of merchantability, fitness, title, non-infringement, accuracy, uninterrupted availability, and freedom from harmful components. We do not warrant agent completion, unique or error-free output, or legal compliance. Non-waivable rights remain unaffected.

## 13. Limitation of Liability

To the maximum extent permitted, neither party is liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or lost profits, revenue, goodwill, data, or business interruption. Except for payment obligations, misuse or infringement of BuilderForce technology, Acceptable Use violations, fraud, willful misconduct, or non-limitable liability, each party's aggregate liability will not exceed the greater of amounts paid for the Service in the prior 12 months or US $100 for free use. Jurisdictional restrictions apply.

## 14. Indemnification

You will defend and indemnify BuilderForce and its affiliates, officers, employees, and contractors against third-party claims and reasonable costs arising from Customer Content, unlawful or unauthorized use, violation of these Terms, or infringement of another's rights. We will promptly notify and cooperate. A settlement may not admit BuilderForce fault or impose obligations without consent.

## 15. Export Controls

You must comply with export-control and sanctions laws and may not provide the Service in embargoed locations or to prohibited parties. Government users receive customary public rights except as required by law or agreed in writing.

## 16. Changes

We may update these Terms for changes in law, risk, or the Service. We will post a new version and effective date and give additional notice or require renewed acceptance for material changes where required. Changes do not retroactively reduce rights in Customer Content.

## 17. Governing Law and Disputes

These Terms are governed by the laws of the State of Michigan, excluding conflict rules and subject to mandatory local law. The parties consent to state and federal courts located in Michigan that have subject-matter jurisdiction. Before filing a claim, each will provide notice and try in good faith for 30 days to resolve it, without limiting urgent injunctive relief or small claims.

## 18. General

Assignment requires consent except for a merger, reorganization, acquisition, or sale of relevant assets to an assignee accepting these Terms. Neither party is liable for delay beyond reasonable control. These Terms, the Privacy Policy, order forms, and any DPA are the entire Service agreement. Unenforceable provisions are limited to the minimum necessary; the rest remains effective. Non-enforcement is not waiver. Electronic notices and signatures are valid.

## 19. Contact

Fix Faster LLC, doing business as BuilderForce.ai  
6513 Basswood Dr.  
Troy, MI 48098  
Legal: legal@builderforce.ai  
Privacy: privacy@builderforce.ai  
Security: security@builderforce.ai
$terms$,
  true,
  NOW()
), (
  'privacy',
  '2.1.0',
  'Privacy Policy for BuilderForce.ai',
  $privacy$# Privacy Policy for BuilderForce.ai

**Effective Date:** August 4, 2026  
**Version:** 2.1.0

Fix Faster LLC, a Michigan limited liability company doing business as BuilderForce.ai (**BuilderForce**, **we**, **us**, or **our**), provides an agentic software-development, collaboration, and AI gateway platform. This Policy explains how we collect, use, disclose, retain, and protect personal information through our websites, applications, APIs, hosted agent runtime, and related services (the **Service**).

## 1. Our Commitments

Your prompts, chats, source code, files, ideas, and other content remain yours. We do not sell personal information, chat history, ideas, or Customer Content. We do not share personal information for cross-context behavioral advertising. We do not use Customer Content to train generalized AI models for other customers unless you separately and expressly opt in.

We process Customer Content only to provide, secure, support, and maintain the Service; follow instructions; prevent abuse; and comply with law. Information must be aggregated or de-identified so it cannot reasonably identify you or reconstruct Customer Content before use for analytics or improvement.

## 2. Scope and Roles

This Policy applies when BuilderForce determines processing purposes, including accounts, billing, our website, support, and security. For Customer Content in an organization workspace, the customer generally acts as controller or business and BuilderForce as processor or service provider. The customer's notice governs its collection, and related requests may need to go to that customer. This Policy does not govern third-party services you connect under your own agreement.

## 3. Information We Collect

We may collect account and profile details; prompts, chat history, ideas, code, repository content, files, datasets, tickets, messages, agent instructions, and output; integration identifiers, permissions, encrypted credentials, webhook data, and returned data; IP address, browser, device, timestamp, usage, diagnostic, audit, and security events; plan, invoice, billing-contact, and limited payment metadata; support, feedback, sales, and preference records; and information authorized administrators, collaborators, integrations, providers, or public repositories supply.

Payment-card details are generally handled by our payment processor. Do not put sensitive information in prompts or repositories unless necessary, lawful, and protected.

## 4. Uses and Legal Bases

We use information to provide requested agents, tools, integrations, authentication, transactions, and support (contract); secure and debug the Service, prevent abuse, enforce limits, and improve reliability (legitimate interests and legal obligations); administer accounts and agreements (contract, legitimate interests, or law); meet legal, tax, accounting, sanctions, and regulatory duties (law); send permitted marketing with opt-out (consent or legitimate interests); and operate optional or non-essential technologies with consent. We balance legitimate interests against individual rights. Consent may be withdrawn without affecting earlier processing.

## 5. AI and Automated Processing

AI systems respond to prompts, analyze content, recommend actions, and perform configured tasks. The product should disclose when users interact with AI. BuilderForce does not intend its general platform output as the sole basis for decisions producing legal or similarly significant effects.

Customers must provide notices, obtain consent, perform required impact assessments, test bias and accuracy, and provide meaningful human review before using the Service for employment, housing, credit, education, insurance, health care, legal services, essential services, or other consequential decisions. Applicable law may give people rights to information, correction, opt-out, appeal, or human review.

## 6. Disclosures

We disclose information to contracted hosting, infrastructure, AI inference, authentication, payment, communication, support, monitoring, and security providers; integrations you choose; authorized workspace administrators and collaborators; authorities or others where reasonably necessary for law, safety, rights, or security; and participants in a corporate transaction subject to confidentiality and notice obligations.

We do **not** sell personal information. We do **not** disclose it for cross-context behavioral advertising or disclose Customer Content to data brokers. If practices change, we will update this Policy and provide required choices first.

## 7. Model Providers and Training

Prompts, Customer Content, and output may go to the model provider selected by you or workspace configuration to fulfill a request. Where commercially available, we configure providers not to train generalized models on Service Data. BuilderForce does not train generalized models for other customers on Customer Content without separate express opt-in. A provider connected with your credentials or separate agreement follows that agreement. Administrators should review provider terms. A current subprocessor list and enterprise DPA should be available online or on request.

## 8. Cookies and Preference Signals

We use necessary storage for authentication, security, preferences, and operation. We request consent before non-essential analytics or advertising technologies where required. Rejecting must be as easy as accepting and choices must remain changeable. Where required, we recognize supported universal opt-out signals such as Global Privacy Control. We do not sell or share personal information for targeted advertising, so such a signal should not reduce core functionality.

## 9. Retention

We retain information only as reasonably necessary for the disclosed purposes, customer instructions, security, disputes, and legal, tax, accounting, or contract requirements. Active workspace data is generally retained while active. Deleted Customer Content is removed from active systems in a commercially reasonable period and backups through normal cycles, unless law or security requires longer. Detailed AI traces and diagnostic logs should be purged on documented schedules, with shorter periods for raw content and identifiers where feasible. Billing, consent, security, and legal records follow applicable limitation and recordkeeping periods. De-identified information may remain longer. Legal holds suspend deletion only as needed.

## 10. Security and Incidents

We use safeguards designed for the information, including access controls, encryption in transit, credential protection, tenant scoping, logging, and vulnerability management. No system is perfectly secure. Users must protect credentials, limit agent permissions, review integrations, and keep backups. We maintain incident response and notify affected customers, people, and regulators as law and contract require. Report issues to security@builderforce.ai.

## 11. International Transfers

Information may be processed in the United States and other provider locations. Where required, we use adequacy decisions, Standard Contractual Clauses, the UK transfer addendum or agreement, contractual protections, and supplementary measures. Customers must select integrations and regions appropriate to their needs. Australian users may request likely overseas locations; Canadian users should understand foreign processing can expose information to lawful foreign access.

## 12. Privacy Rights

Depending on location and our role, you may have rights to know and access; correct; delete; receive portable data; object or restrict; withdraw consent; opt out of sale, sharing, targeted advertising, or qualifying profiling; limit sensitive-data use; learn about certain recipients; appeal a refusal; and receive equal service without unlawful discrimination.

Use the Service privacy-request feature or email privacy@builderforce.ai. Identify the right and workspace. We may verify identity and authority. Authorized agents may act where permitted. We will meet applicable deadlines and explain denials and appeal rights. If we process solely for a customer, we may refer the request to that customer or assist it. Appeal by replying with **Privacy Appeal** in the subject. You may complain to a competent regulator.

## 13. United States State Notices

This section supplements the Policy for applicable comprehensive state laws, including California, Colorado, Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, and Virginia as their laws apply and take effect.

Section 3 categories may include identifiers, customer records, commercial information, internet activity, approximate location, professional information, inferences, and Customer Content, collected from you, your organization, integrations, providers, and Service use for Section 4 purposes and disclosed to Section 6 recipients. We do not sell them or share them for cross-context behavioral advertising.

We process sensitive information only as necessary, with consent where required, or as permitted. We honor applicable targeted-advertising and profiling opt-outs, universal signals, and appeals. California residents may request categories of sources, purposes, and recipients and limit qualifying sensitive-data use. We offer no financial incentives for personal information.

Consumer health data, biometric identifiers, precise geolocation, or children's data may require separate notices, affirmative consent, signed sale authorization, assessments, processor deletion, and other controls. Customers may not enable such processing without legal and safety review.

## 14. EEA, Switzerland, and United Kingdom

Where GDPR-style laws apply, Section 4 states our controller bases. Individuals may access, correct, erase, restrict, port, object, withdraw consent, and complain to a supervisory authority. We will not make solely automated legal or similarly significant decisions unless authorized with safeguards. Covered customers may request a DPA addressing instructions, confidentiality, security, subprocessors, rights and incident assistance, deletion or return, audits, and transfers. Where legally required, BuilderForce should publish a qualified local representative.

## 15. Canada, Brazil, and Australia

Canadian users may have rights under PIPEDA and provincial laws concerning accountability, meaningful consent, access, correction, safeguards, limited retention, and complaints. Quebec may require added transparency, governance, incident, cross-border assessment, and automated-decision controls.

Brazilian users may have LGPD rights to confirmation, access, correction, anonymization, portability, deletion, sharing information, consent withdrawal, and review of certain automated decisions. BuilderForce should identify a local data-protection contact or representative where required.

Australian users covered by the Privacy Act may request access or correction and complain. Our notice should name likely overseas disclosure countries where practicable, and covered incidents are handled under the Notifiable Data Breaches scheme.

## 16. Children and Teens

The Service is for business users age 18 or older and is not directed to children under 13. We do not knowingly collect children's information without verifiable parental consent. Contact privacy@builderforce.ai to report it. Services likely accessed by minors may trigger design, age-assurance, consent, safety, advertising, profiling, reporting, and deletion duties and require a legal and safety review.

## 17. Marketing

Opt out through an email unsubscribe link or privacy@builderforce.ai. Transactional and security messages may continue. Marketing must use accurate sender information and subject lines, legally required identification and contact information, and durable suppression records.

## 18. Changes

We may update this Policy as practices, laws, or the Service change. We will post the version and effective date and provide notice or obtain consent when required. We will not materially expand use of previously collected Customer Content inconsistently without an appropriate legal basis and notice.

## 19. Contact

Fix Faster LLC, doing business as BuilderForce.ai  
6513 Basswood Dr.  
Troy, MI 48098  
Privacy requests and appeals: privacy@builderforce.ai  
Legal: legal@builderforce.ai  
Security incidents: security@builderforce.ai

Where applicable law requires a data-protection officer or local representative, BuilderForce will publish that representative's contact details on the legal page before offering the Service in that jurisdiction.
$privacy$,
  true,
  NOW()
);

INSERT INTO legal_document_versions (
  document_type, version, title, content, change_kind, changed_by, created_at
)
SELECT document_type, version, title, content, 'publish', published_by, published_at
FROM legal_documents
WHERE version = '2.1.0' AND is_active = true;

INSERT INTO ide_agents (
  id, tenant_id, name, title, bio, skills, base_model, status,
  runtime_support, published, price_cents, builtin_kind
)
SELECT
  'compliance-auditor-t' || t.id,
  t.id,
  'Compliance Audit',
  'Compliance Audit Agent — privacy, AI governance, and website readiness',
  'Audits connected GitHub source and deployed website behavior against the privacy, consumer-protection, marketing, children''s-data, accessibility, and AI-transparency rules that apply to the project. It inventories data and model flows, reads implementation evidence instead of trusting policy claims, maps every finding to a jurisdiction and authority, distinguishes a missing control from an unverified one, and files one independently remediable ticket per gap. It never represents a readiness scan as legal certification and requires counsel review for launch decisions.',
  '["github","privacy","ai-governance","compliance-audit","data-protection","accessibility"]',
  'builderforce-default', 'active', 'cloud', false, 0, 'compliance_auditor'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM ide_agents a
  WHERE a.tenant_id = t.id AND a.builtin_kind = 'compliance_auditor'
);
