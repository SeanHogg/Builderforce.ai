> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #176
> _Each agent that updates this PRD signs its change below._

# PRD: Managed Hosting - Onboarding Funnel Optimization

## Problem & Goal

**Problem:** Our current managed hosting onboarding funnel for new customers is experiencing a high drop-off rate, leading to lost revenue and inefficient resource allocation for our sales and support teams. Customers are struggling with the complexity and time commitment required to get started, resulting in a poor initial experience.

**Goal:** To optimize the managed hosting onboarding funnel to increase conversion rates by 15% and reduce the average onboarding time by 20% within the next quarter. This will be achieved by simplifying the user journey, providing clearer guidance, and automating key steps.

## Target Users / ICP Roles

*   **Small to Medium Business (SMB) Owners:** Decision-makers responsible for selecting and managing hosting solutions for their businesses. They often have limited technical expertise and are looking for a hassle-free, high-performance hosting experience.
*   **Technical Lead / IT Manager (Mid-Market/Enterprise):** Responsible for evaluating and implementing technical solutions. They require clear technical specifications, security assurances (e.g., SOC 2 compliance), and efficient deployment processes.

## Scope

The scope of this project is to redesign and implement an optimized onboarding funnel specifically for our Managed Hosting product. This includes:

*   Revising the initial sign-up flow for clarity and user guidance.
*   Streamlining the pre-provisioning information gathering process.
*   Automating account setup and initial deployment where possible.
*   Introducing guided setup wizards for essential configurations.
*   Enhancing communication and educational materials throughout the onboarding journey.
*   Ensuring seamless integration with our existing billing and account management systems.
*   Validating and displaying SOC 2 compliance readiness information early in the funnel.

## Functional Requirements

1.  **Simplified Sign-up Flow:**
    *   Reduce the number of required fields in the initial sign-up form.
    *   Implement inline validation and helpful tooltips for all form fields.
    *   Provide clear package selection options with comparative features.

2.  **Intelligent Information Gathering:**
    *   Utilize conditional logic to ask for relevant information based on chosen hosting plan and user role.
    *   Offer pre-filled options for common configurations.
    *   Integrate with existing customer data where appropriate (e.g., for existing clients looking to add managed hosting).

3.  **Automated Account & Environment Setup:**
    *   Automate the creation of user accounts and associated managed hosting environments upon successful payment.
    *   Provide real-time status updates on provisioning progress.

4.  **Guided Setup Wizard:**
    *   Develop an interactive wizard to guide users through essential post-provisioning configurations (e.g., domain connection, initial security settings, basic application deployment for common types).
    *   Allow users to skip advanced configuration steps if they are not immediately needed, with clear options to return later.

5.  **Enhanced Communication & Education:**
    *   Send triggered email notifications at key stages of the onboarding process (e.g., welcome, provisioning complete, setup wizard prompt).
    *   Provide access to a dedicated "Getting Started" guide and FAQs within the onboarding portal.
    *   Clearly display available support channels.

6.  **SOC 2 Compliance Information Display:**
    *   Clearly communicate our current SOC 2 compliance status and relevant audit information early in the funnel.
    *   Provide resources explaining what SOC 2 compliance means for the customer.

7.  **Integration with Billing & Account Management:**
    *   Ensure all new managed hosting subscriptions are correctly recorded and managed within the existing billing and account management systems.

## Acceptance Criteria

*   **Conversion Rate:** The overall conversion rate from initiating managed hosting sign-up to a successfully provisioned and configured account increases by 15% within 90 days post-launch.
*   **Onboarding Time:** The average time from sign-up initiation to a fully provisioned and ready-to-use managed hosting environment decreases by 20% within 90 days post-launch.
*   **Drop-off Analysis:** Significant reduction in user drop-off observed at the initial sign-up, information gathering, and configuration steps.
*   **User Feedback:** Positive sentiment scores (measured through post-onboarding surveys) regarding ease of use, clarity, and overall experience.
*   **Successful Provisioning:** 99% of accounts are provisioned successfully without manual intervention.
*   **Wizard Completion:** At least 70% of users complete the guided setup wizard within 24 hours of provisioning.
*   **SOC 2 Visibility:** New customers can easily find and understand information about our SOC 2 compliance during the onboarding process.

## Out of Scope

*   **Complete Redesign of the General Billing System:** This PRD focuses on the onboarding *funnel* for managed hosting, not a full overhaul of the entire billing infrastructure.
*   **Advanced Feature Configuration:** Deep configuration of specific applications or complex server setups will remain outside the scope of the *initial* onboarding wizard. Users will be guided to advanced documentation or support for these.
*   **Migration Services:** Automated migration of existing websites or data from other hosts is out of scope for this project.
*   **Enterprise-Specific Custom Workflows:** Highly tailored onboarding processes for large enterprise clients requiring bespoke solutions are out of scope for this generalized funnel optimization.
*   **New Marketplace Integrations:** Development of new integrations within the marketplace is not part of this onboarding funnel optimization.