/**
 * Platform legal text used when the database has not been seeded yet.
 *
 * The matching SQL migration is the production publication path. Keeping the
 * complete documents here means a fresh/misconfigured environment never falls
 * back to a one-sentence placeholder while migrations are catching up.
 *
 * These documents are product defaults, not a substitute for advice from
 * counsel about Fix Faster LLC's actual place of formation, tax posture,
 * insurance, vendors, or data-transfer arrangements.
 */

export const LEGAL_POLICY_VERSION = '2.1.0';
export const LEGAL_POLICY_EFFECTIVE_DATE = 'August 4, 2026';

export const BUILDERFORCE_TERMS_OF_USE = String.raw`# Terms of Use for BuilderForce.ai

**Effective Date:** August 4, 2026  
**Version:** 2.1.0

These Terms of Use (the **Terms**) are an agreement between you and Fix Faster LLC, a Michigan limited liability company doing business as BuilderForce.ai (**BuilderForce**, **we**, **us**, or **our**). They govern your access to and use of BuilderForce.ai, its websites, applications, APIs, hosted agent runtime, collaboration features, integrations, and related services (collectively, the **Service**).

By creating an account, accepting these Terms, or using the Service, you agree to them. If you use the Service for an organization, you represent that you have authority to bind that organization, and **you** includes that organization. If you do not agree, do not use the Service.

## 1. Eligibility and Accounts

You must be at least 18 years old and legally able to enter into this agreement. The Service is intended for business and professional use and is not directed to children under 13. You must provide accurate account information, protect credentials and API keys, use reasonable security controls, and promptly notify us at security@builderforce.ai of suspected unauthorized access. You are responsible for activity under your account and for configuring user, agent, repository, integration, and approval permissions.

## 2. The Service and Agentic Operation

BuilderForce is an agentic platform. At your direction, software agents may analyze repositories and other connected sources, generate or modify code and content, call tools, communicate with third-party systems, create tickets or pull requests, and take other configured actions. Agent output is probabilistic and may be inaccurate, incomplete, insecure, or unsuitable.

You are responsible for reviewing outputs, maintaining backups and version control, setting appropriate permission and approval gates, and applying qualified human review before deploying code or using output for legal, medical, financial, employment, housing, credit, insurance, safety-critical, or other consequential decisions. BuilderForce does not provide professional advice and does not guarantee that agent output is correct, compliant, non-infringing, secure, or fit for production.

We may improve, modify, suspend, or discontinue Service features. We will provide notice when reasonably practicable if a change materially reduces paid functionality.

## 3. Your Content, Chats, Code, and Ideas

As between you and BuilderForce, you retain all right, title, and interest in content you or your authorized users submit to the Service, including prompts, chat history, ideas, requirements, files, source code, repository content, datasets, credentials, and other materials (**Customer Content**). BuilderForce does not acquire ownership of Customer Content merely because you use the Service.

You grant BuilderForce a limited, non-exclusive, worldwide license to host, copy, transmit, display, process, and create technical transformations of Customer Content only as necessary to provide, secure, support, and maintain the Service; comply with your instructions; prevent abuse; and comply with law. This license ends when the relevant Customer Content is deleted from our systems, subject to reasonable backup cycles, legal obligations, and the retention terms in our Privacy Policy.

We do not sell Customer Content, chat history, or ideas. We do not use Customer Content to train generalized AI models for other customers unless you separately and expressly opt in. If you submit feedback about BuilderForce itself, you grant us a perpetual, non-exclusive, royalty-free right to use that feedback without identifying you or disclosing your confidential information.

You represent that you have the rights and permissions needed for Customer Content and for the instructions you give the Service. You must not submit personal data, confidential information, or regulated data unless your use is permitted by law and your agreement and configuration support that data.

## 4. Generated Output

Subject to applicable law and third-party rights, as between you and BuilderForce, you own the output generated specifically for you from your Customer Content. Because AI systems may generate similar output for different users, output may not be unique. Your ownership does not extend to BuilderForce technology, third-party materials, open-source components, or output generated for another customer.

You are responsible for validating output, licenses, attribution requirements, security, and legal compliance before use or distribution. Where the law does not recognize ownership of machine-generated material, BuilderForce assigns to you any rights it may have in that output, excluding BuilderForce technology and third-party materials.

## 5. BuilderForce Technology

BuilderForce and its licensors retain all rights in the Service, including its software, designs, models, orchestration, documentation, trademarks, and aggregate or de-identified operational information that cannot reasonably identify you or reconstruct Customer Content. Except as expressly allowed, you may not copy, resell, lease, reverse engineer, bypass access controls, or use the Service to build a competing service through systematic extraction. Open-source components remain governed by their licenses.

## 6. Acceptable Use

You may not use the Service to:

1. violate law, regulation, sanctions, export controls, privacy rights, intellectual-property rights, or contractual obligations;
2. create or distribute malware, credential theft, destructive code, unlawful surveillance, spam, fraud, deceptive impersonation, or content that facilitates material harm;
3. access systems, repositories, accounts, or data without authorization;
4. bypass rate limits, security controls, approval gates, or usage restrictions;
5. make solely automated consequential decisions about a person where prohibited by law or without required notices, assessments, safeguards, and human review;
6. collect or process children's data, biometric data, precise geolocation, health data, or other sensitive data without a valid legal basis and required consent; or
7. interfere with the Service or place unreasonable load on it.

We may investigate suspected misuse and limit or suspend access when reasonably necessary to protect users, third parties, or the Service.

## 7. Third-Party Services and Open Source

The Service may connect to AI model providers, Git hosting, cloud platforms, messaging services, payment providers, and other third parties selected by you or used as our subprocessors. When you enable an integration, you direct us to transmit the information necessary to perform your request. Third-party services are governed by their own terms and privacy practices, and BuilderForce is not responsible for services it does not control.

You are responsible for third-party credentials, licenses, fees, usage limits, and permissions. We may disable an integration that creates a security, legal, or operational risk. Our current subprocessor list is at https://builderforce.ai/legal/subprocessors and our customer Data Processing Addendum is at https://builderforce.ai/legal/dpa.

## 8. Confidentiality

Each party may receive nonpublic information that the other identifies as confidential or that reasonably should be understood as confidential. The receiving party will use it only to perform or exercise rights under these Terms, protect it with reasonable care, and disclose it only to personnel and service providers who need to know and are bound to protect it. These duties do not apply to information that is public through no breach, already lawfully known, independently developed, or lawfully obtained without restriction. Required legal disclosures may be made after notice when legally permitted.

## 9. Privacy and Data Processing

Our Privacy Policy explains how BuilderForce handles personal information. When BuilderForce processes personal data on behalf of a business customer, the customer is the controller or business and BuilderForce is its processor or service provider, unless law provides otherwise. A Data Processing Addendum, including appropriate international-transfer terms, is available at https://builderforce.ai/legal/dpa.

You are responsible for providing required notices, obtaining required consents, honoring data-subject rights, and configuring the Service consistently with your legal obligations. You must not direct BuilderForce to process personal data unlawfully.

## 10. Fees, Taxes, and Renewals

Paid plans, usage charges, credits, limits, renewal terms, and cancellation rules are shown at purchase or in an order form. Unless stated otherwise, subscriptions renew automatically for the same period until canceled before renewal. You authorize applicable charges and are responsible for taxes other than taxes on our net income. Fees are nonrefundable except where required by law or expressly stated. We may change future prices with advance notice; changes apply at the next renewal unless otherwise stated.

## 11. Suspension and Termination

You may stop using the Service and close your account at any time, subject to outstanding payment obligations and any organization administrator controls. We may suspend or terminate access for a material breach, unlawful or dangerous use, security risk, nonpayment, or where required by law. When practicable, we will provide notice and an opportunity to cure.

After termination, your right to use the Service ends. Sections that by their nature should survive will survive, including ownership, confidentiality, payment obligations, disclaimers, limitations of liability, indemnity, and dispute terms. You should export Customer Content before termination. We will handle remaining personal information under the Privacy Policy and applicable law.

## 12. Warranties and Disclaimers

Each party represents that it has authority to enter into these Terms. Except for any express warranty in an order form, the Service and all output are provided **as is** and **as available**. To the maximum extent permitted by law, BuilderForce disclaims all implied warranties, including merchantability, fitness for a particular purpose, title, non-infringement, accuracy, uninterrupted availability, and freedom from harmful components. We do not warrant that agents will complete a task, that output will be unique or error-free, or that use of the Service will satisfy your compliance obligations.

Nothing in these Terms excludes warranties or rights that cannot lawfully be excluded.

## 13. Limitation of Liability

To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenues, goodwill, data, or business interruption, even if advised of the possibility.

Except for your payment obligations, your infringement or misuse of BuilderForce technology, violation of the Acceptable Use section, or either party's fraud, willful misconduct, or liability that cannot legally be limited, each party's total aggregate liability arising from the Service or these Terms will not exceed the greater of (a) amounts you paid BuilderForce for the Service during the 12 months before the event giving rise to liability or (b) US $100 if you used only a free service.

Some jurisdictions do not allow certain exclusions or limits, so these limits apply only to the extent permitted.

## 14. Indemnification

You will defend and indemnify BuilderForce and its affiliates, officers, employees, and contractors against third-party claims, damages, and reasonable costs arising from Customer Content, your unlawful or unauthorized use of the Service, your violation of these Terms, or your infringement of another person's rights. BuilderForce will promptly notify you and reasonably cooperate. You may not settle a claim in a way that admits fault by or imposes obligations on BuilderForce without our written consent.

## 15. Export Controls and Government Use

You must comply with applicable export-control and sanctions laws and may not use or provide the Service in an embargoed location or to a prohibited party. Government users receive only the rights customarily provided to the public under these Terms, except as required by law or agreed in writing.

## 16. Changes to These Terms

We may update these Terms to reflect changes in law, risk, or the Service. We will post the new version and effective date and provide additional notice of material changes when required. If a material change requires renewed acceptance, continued access may be conditioned on acceptance. Changes do not retroactively reduce rights in Customer Content.

## 17. Governing Law and Disputes

These Terms are governed by the laws of the State of Michigan, without regard to conflict-of-law principles, except where mandatory consumer or local law applies. The parties consent to the state and federal courts located in Michigan that have subject-matter jurisdiction. Before filing a claim, each party will give the other written notice and attempt in good faith for 30 days to resolve the dispute informally. This section does not prevent either party from seeking urgent injunctive relief or using a small-claims court with jurisdiction.

## 18. General

Neither party may assign these Terms without the other's consent, except in connection with a merger, acquisition, corporate reorganization, or sale of substantially all relevant assets, provided the assignee agrees to these Terms. We are not liable for delay caused by events beyond reasonable control. These Terms, the Privacy Policy, applicable order forms, and any Data Processing Addendum are the entire agreement for the Service and supersede prior discussions on the same subject. If a provision is unenforceable, it will be limited to the minimum extent necessary and the rest remains effective. Failure to enforce a provision is not a waiver. Headings are for convenience only. Electronic notices and signatures are valid.

## 19. Contact

Fix Faster LLC, doing business as BuilderForce.ai  
6513 Basswood Dr.  
Troy, MI 48098  
Legal: legal@builderforce.ai  
Privacy: privacy@builderforce.ai  
Security: security@builderforce.ai
`;

export const BUILDERFORCE_PRIVACY_POLICY = String.raw`# Privacy Policy for BuilderForce.ai

**Effective Date:** August 4, 2026  
**Version:** 2.1.0

Fix Faster LLC, a Michigan limited liability company doing business as BuilderForce.ai (**BuilderForce**, **we**, **us**, or **our**), provides an agentic software-development, collaboration, and AI gateway platform. This Privacy Policy explains how we collect, use, disclose, retain, and protect personal information when you use our websites, applications, APIs, hosted agent runtime, and related services (the **Service**).

## 1. Our Commitments

Your prompts, chats, source code, files, ideas, and other content remain yours. We do not sell personal information, chat history, ideas, or Customer Content. We do not share personal information for cross-context behavioral advertising. We do not use Customer Content to train generalized AI models for other customers unless you separately and expressly opt in.

We process Customer Content only to provide, secure, support, and maintain the Service; follow your instructions; prevent abuse; and comply with law. Aggregated or de-identified information must not reasonably identify you or reconstruct Customer Content before we use it for analytics or service improvement.

## 2. Scope and Roles

This Policy applies when BuilderForce determines why and how personal information is processed, such as for accounts, billing, our website, support, and security. For Customer Content submitted through an organization workspace, the customer generally acts as controller or business and BuilderForce acts as processor or service provider under the customer's instructions. The customer's privacy notice governs its collection and use, and requests about that data may need to be directed to the customer.

This Policy does not govern third-party websites, integrations, repositories, model providers, or services that you connect under your own account or agreement.

## 3. Information We Collect

Depending on how you use the Service, we collect:

1. **Account and profile information:** name, email address, organization, role, preferences, authentication identifiers, and account settings.
2. **Customer Content:** prompts, chat history, agent instructions, ideas, code, repository content, files, datasets, tickets, messages, generated output, and content sent through connected tools.
3. **Integration information:** repository and service identifiers, installation metadata, permissions, encrypted credentials or tokens, webhook data, and information returned by connected services.
4. **Usage and device information:** IP address, browser and device information, timestamps, pages or features used, request and diagnostic metadata, crash reports, audit logs, and security events.
5. **Transaction information:** plan, invoices, payment status, billing contact, and limited payment metadata. Payment-card details are generally handled by our payment processor rather than stored by BuilderForce.
6. **Communications:** support requests, feedback, survey responses, sales communications, and records of preferences or consent.
7. **Information from others:** an organization administrator, collaborator, integration, service provider, public repository, or other source may provide information about you where authorized.

Please do not place sensitive personal information in prompts or repositories unless it is necessary, lawful, and covered by appropriate contractual and technical safeguards.

## 4. How We Use Information and Our Legal Bases

We use personal information to:

- provide the Service, run requested agents and tools, synchronize integrations, authenticate users, process transactions, and provide support (performance of a contract or steps requested before a contract);
- secure the Service, prevent fraud and abuse, debug failures, enforce limits, maintain audit trails, and improve reliability (legitimate interests and, where applicable, legal obligations);
- administer accounts, communicate operational or legal notices, and enforce agreements (contract, legitimate interests, or legal obligation);
- comply with law, valid legal process, sanctions, tax, accounting, and regulatory duties (legal obligation);
- send product or marketing communications where permitted (consent or legitimate interests, with an opt-out); and
- use optional features or non-essential cookies where you have consented.

Where we rely on legitimate interests, we balance those interests against the rights and reasonable expectations of affected people. Where we rely on consent, you may withdraw it at any time without affecting earlier lawful processing.

## 5. AI and Automated Processing

The Service uses AI systems to respond to prompts, analyze content, recommend actions, and perform tasks you configure. We disclose within the product when users interact with AI agents. BuilderForce does not intend its general platform outputs to be the sole basis for decisions producing legal or similarly significant effects about individuals.

Customers must provide required notices, obtain consent where required, perform applicable impact assessments, test for bias and accuracy, and provide meaningful human review before using the Service for employment, housing, credit, education, insurance, health care, legal services, essential services, or other consequential decisions. Depending on applicable law, individuals may have rights to information, correction, opt-out, appeal, or human review concerning automated processing.

## 6. How We Disclose Information

We disclose information only as needed for the following purposes:

1. **Service providers and subprocessors:** hosting, infrastructure, AI inference, authentication, payments, communications, support, monitoring, and security providers process information for us under contractual restrictions.
2. **Integrations you choose:** when you connect Git providers, model providers, messaging tools, or other services, you direct us to exchange the information necessary to perform your request. If you use your own provider account or key, that provider's terms govern its processing.
3. **Your organization and collaborators:** administrators may manage workspace accounts, permissions, content, logs, and exports. Content is shared with collaborators according to workspace settings.
4. **Legal and safety:** we may disclose information when reasonably necessary to comply with law or valid process, protect rights and safety, investigate abuse, or secure the Service. We seek to narrow requests and provide notice when legally permitted.
5. **Corporate transactions:** information may transfer as part of a merger, financing, reorganization, bankruptcy, or sale of assets, subject to confidentiality and this Policy or notice of material changes.

We do **not** sell personal information. We do **not** disclose personal information for cross-context behavioral advertising. We do **not** disclose Customer Content to data brokers. If our practices change, we will update this Policy and provide legally required choices before the change applies.

## 7. Model Providers and Training

Prompts, Customer Content, and output may be sent to the AI model provider selected by you or by your workspace configuration to fulfill a request. We configure providers, where commercially available, so Service Data is not used to train generalized models. BuilderForce itself does not use Customer Content to train generalized AI models for other customers without separate, express opt-in consent.

If you connect a model or other service using your own credentials or choose a provider governed by your separate agreement, its retention and training terms apply. Workspace administrators should review provider settings and contracts before enabling them. Our current subprocessor list is at https://builderforce.ai/legal/subprocessors and our customer Data Processing Addendum is at https://builderforce.ai/legal/dpa.

## 8. Cookies and Similar Technologies

We use strictly necessary storage and cookies for authentication, security, preferences, and core operation. We request consent before using non-essential analytics or advertising technologies where required. Users must be able to reject non-essential technologies as easily as accepting them and later change their choice.

Where required, we recognize supported universal opt-out preference signals, such as Global Privacy Control, as a request to opt out of sale, sharing, or targeted advertising. Because we do not sell or share personal information for those purposes, the signal should not reduce core Service functionality.

## 9. Retention

We keep personal information only as long as reasonably necessary for the purposes described here, including to provide the Service, honor customer instructions, maintain security, resolve disputes, and meet legal, tax, accounting, and contractual obligations. Retention depends on data type and workspace configuration:

- active account and workspace data is generally retained while the account or workspace remains active;
- deleted Customer Content is removed from active systems within a commercially reasonable period and from backups through the normal backup cycle, unless law or security needs require longer retention;
- detailed AI request traces and diagnostic logs are purged under documented operational schedules, with shorter periods for raw content and identifiers where feasible;
- billing, transaction, consent, security, and legal records are retained for applicable limitation and recordkeeping periods; and
- de-identified information may be retained longer when it cannot reasonably be linked back to a person or Customer Content.

Workspace administrators may set or request additional retention controls. We may preserve information subject to a legal hold and will delete or de-identify it when the hold ends and no other lawful need remains.

## 10. Security and Incident Response

We use administrative, technical, and organizational safeguards designed for the nature of the information, including access controls, encryption in transit, credential protection, tenant scoping, logging, and vulnerability management. No system is perfectly secure. You are responsible for protecting credentials, limiting agent permissions, reviewing third-party integrations, and maintaining backups and version control.

We maintain an incident-response process and will notify affected customers, individuals, and regulators of a personal-data breach as required by applicable law and contract. Report suspected vulnerabilities to security@builderforce.ai.

## 11. International Data Transfers

BuilderForce and its providers may process information in the United States and other countries where we or they operate. Those countries may have different privacy laws. Where required, we use recognized safeguards for restricted transfers, such as adequacy decisions, the European Commission's Standard Contractual Clauses, the UK International Data Transfer Addendum or Agreement, contractual protections, and supplementary security measures.

Customers remain responsible for configuring integrations and selecting provider regions consistent with their requirements. Australian users may request information about likely overseas processing locations; Canadian users should understand that information processed outside Canada may be accessible to foreign authorities under local law.

## 12. Your Privacy Rights

Depending on your location and our role, you may have the right to:

- know whether and how we process personal information and obtain access to it;
- correct inaccurate information;
- delete information, subject to lawful exceptions;
- receive a portable copy of information you provided;
- object to or restrict certain processing;
- withdraw consent;
- opt out of sale, sharing, targeted advertising, or certain profiling;
- limit the use or disclosure of sensitive personal information;
- obtain information about certain third parties to which data was disclosed;
- appeal a refusal of a privacy request; and
- receive equal service without unlawful discrimination for exercising a right.

Submit a request through the privacy-request feature in the Service or email privacy@builderforce.ai. Describe the right and account or workspace involved. We may verify your identity and authority, and authorized agents may submit requests where permitted. We will respond within the period required by applicable law and explain any denial and available appeal. If BuilderForce processes the information solely for a customer, we may direct the request to that customer or assist it under our agreement.

You may appeal a decision by replying to our response with **Privacy Appeal** in the subject line. You may also complain to your local privacy or data-protection authority.

## 13. United States State Privacy Notices

This section supplements the Policy for residents of states with applicable comprehensive privacy laws, including California, Colorado, Connecticut, Delaware, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah, and Virginia, as those laws take effect and apply to us.

The categories described in Section 3 may include identifiers, customer records, commercial information, internet or network activity, approximate location, professional information, inferences, and Customer Content. We collect them from you, your organization, integrations, service providers, and use of the Service for the purposes in Section 4. We disclose them to the recipient categories in Section 6. We do not sell these categories or share them for cross-context behavioral advertising.

We process sensitive personal information only where necessary for the Service, with consent where required, or as otherwise permitted by law. We honor applicable rights to opt out of targeted advertising and qualifying profiling, universal opt-out signals, and appeals. California residents may also request the categories of sources, business purposes, and recipients and may limit certain uses of sensitive personal information. We do not offer financial incentives for personal information.

If the Service processes consumer health data, biometric identifiers, precise geolocation, or children's data, additional state laws may require separate notices, affirmative consent, signed authorization for sale, impact assessments, and deletion across processors. Customers may not enable such processing without satisfying those requirements.

## 14. European Economic Area, Switzerland, and United Kingdom

Where the GDPR, UK GDPR, or similar law applies, the legal bases in Section 4 govern our controller processing. Individuals may exercise access, correction, erasure, restriction, portability, objection, and consent-withdrawal rights and may complain to a competent supervisory authority. We will not subject a person to a solely automated decision that produces legal or similarly significant effects unless authorized by law with required safeguards.

Business customers may request a Data Processing Addendum addressing controller instructions, confidentiality, security, subprocessors, assistance with rights and incidents, deletion or return, audits, and restricted transfers. Where required because BuilderForce targets or monitors individuals in a jurisdiction without an establishment there, BuilderForce should appoint and publish the contact details of a qualified local representative.

## 15. Canada, Brazil, and Australia

Canadian users may have rights under PIPEDA and substantially similar provincial laws, including accountability, meaningful consent, access, correction, safeguards, limited retention, and a way to challenge compliance. Quebec residents may have additional transparency, governance, confidentiality-incident, cross-border assessment, and automated-decision rights.

Brazilian users may have rights under the Lei Geral de Protecao de Dados, including confirmation, access, correction, anonymization, portability, deletion, information about sharing, consent withdrawal, and review of certain automated decisions. Where required, BuilderForce should identify its Brazilian data-protection contact or representative.

Australian users covered by the Privacy Act may request access or correction and complain about handling of personal information. Our notice should identify likely overseas disclosure countries where practicable, and covered incidents are handled under the Notifiable Data Breaches scheme.

## 16. Children and Teens

The Service is intended for business users age 18 or older and is not directed to children under 13. We do not knowingly collect personal information from children under 13 without verifiable parental consent. If you believe a child provided information unlawfully, contact privacy@builderforce.ai so we can investigate and delete it as required.

Services likely to be accessed by minors may trigger additional design, age-assurance, parental-consent, safety, advertising, profiling, reporting, and deletion duties. Customers may not configure BuilderForce for minors without an appropriate legal and safety review.

## 17. Marketing Communications

You may opt out of marketing email through the unsubscribe link or by contacting privacy@builderforce.ai. We will honor opt-outs as required by law. Transactional and security messages may continue. Marketing programs must use accurate sender information and subject lines, include legally required identification and contact information, and maintain suppression records so an opt-out is not accidentally reversed.

## 18. Changes to This Policy

We may update this Policy as our practices, laws, or the Service change. We will post the new version and effective date and provide additional notice or obtain consent when required. We will not materially expand use of previously collected Customer Content in a manner inconsistent with this Policy without an appropriate legal basis and notice.

## 19. Contact

Fix Faster LLC, doing business as BuilderForce.ai  
6513 Basswood Dr.  
Troy, MI 48098  
Privacy requests and appeals: privacy@builderforce.ai  
Legal: legal@builderforce.ai  
Security incidents: security@builderforce.ai

Where applicable law requires a data-protection officer or local representative, BuilderForce will publish that representative's contact details on the BuilderForce.ai legal page before offering the Service in that jurisdiction.
`;
