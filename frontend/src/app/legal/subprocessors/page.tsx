import { getTranslations } from 'next-intl/server';
import { CompliancePage } from '@/components/legal/CompliancePage';
import styles from './page.module.css';

const providers = [
  {
    provider: 'Cloudflare',
    purpose: 'Hosting, edge security, and storage',
    safeguards: 'Account data, content, and telemetry; protected by a DPA and transfer safeguards.',
  },
  {
    provider: 'PostgreSQL hosting provider',
    purpose: 'Application database',
    safeguards: 'Account and workspace data; configured region and encryption controls.',
  },
  {
    provider: 'OpenAI or customer-selected AI providers',
    purpose: 'Model inference',
    safeguards: 'Prompt and content required for the request; API or business terms, with training disabled where contractually available.',
  },
  {
    provider: 'Resend or configured mail provider',
    purpose: 'Transactional email',
    safeguards: 'Email address and message-delivery metadata.',
  },
  {
    provider: 'Stripe',
    purpose: 'Payments',
    safeguards: 'Billing identifiers; payment-card data is handled directly by Stripe.',
  },
  {
    provider: 'Google Tag Manager',
    purpose: 'Optional analytics tag delivery',
    safeguards: 'Loads only after opt-in; Global Privacy Control disables optional analytics.',
  },
];

export default async function Page() {
  const t = await getTranslations('legal.titles');
  return (
    <CompliancePage title={t('subprocessors')} currentHref="/legal/subprocessors">
      <p className={styles.intro}>
        Providers are used only when the corresponding feature is enabled. Customers receive notice of material additions through this page and may object by contacting <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a>.
      </p>

      <div className={styles.tableShell}>
        <table className={styles.table}>
          <caption className={styles.caption}>BuilderForce service providers and their data safeguards</caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Purpose</th>
              <th scope="col">Data and safeguards</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((row) => (
              <tr key={row.provider}>
                <td data-label="Provider"><strong>{row.provider}</strong></td>
                <td data-label="Purpose">{row.purpose}</td>
                <td data-label="Data and safeguards">{row.safeguards}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className={styles.note}>
        <span aria-hidden="true">i</span>
        <p>Exact provider selection and region can vary by customer configuration. A tenant-specific list is available on request.</p>
      </aside>
    </CompliancePage>
  );
}
