/**
 * The confirmation the safety gate pauses a run on — the Brain loop's own approval,
 * rendered with WHY it is asking (`classifyAction` reasons) and WHAT it would act on.
 *
 * When the reason is a site the person has not allowed, "Allow" IS the grant: it calls
 * `chrome.permissions.request` inside this click (Chrome requires a user gesture), and
 * only a granted permission lets the run continue.
 */
import { ToolConfirmBar } from '@seanhogg/builderforce-brain-ui';
import { t, type MessageKey } from '../i18n/t';
import { BROWSER_TOOL } from '../tools/toolNames';
import { isPlatformTool } from '../tools/platformTools';
import { classifyAction, originOf, type SafetyReason } from '../tools/safety';
import { useServices } from './hooks';
import { toolLabelKey } from './toolLabels';

const REASON_KEY: Record<SafetyReason, MessageKey> = {
  site_not_allowed: 'reasonSiteNotAllowed',
  submit: 'reasonSubmit',
  purchase: 'reasonPurchase',
  send: 'reasonSend',
  destructive: 'reasonDestructive',
  sensitive_field: 'reasonSensitiveField',
  unknown_element: 'reasonUnknownElement',
  platform_write: 'reasonPlatformWrite',
};

export function ConfirmCard({ chatId, call }: { chatId: number; call: { name: string; args: unknown } }) {
  const services = useServices();
  const safety = services.safety();
  // A platform tool pauses only because it writes; the browser rules do not apply to it.
  const platform = isPlatformTool(call.name);
  const reasons: SafetyReason[] = platform ? ['platform_write'] : classifyAction(call.name, call.args, safety);
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>;
  const site = call.name === BROWSER_TOOL.navigate ? originOf(typeof args.url === 'string' ? args.url : null) : originOf(safety.url);
  const ref = typeof args.ref === 'string' ? args.ref : '';
  // A platform tool is named by what it is (`builtin_tasks_create`); a browser one by its element or URL.
  const target = platform ? call.name : ref ? (safety.factsFor(ref)?.name || ref) : typeof args.url === 'string' ? args.url : '';
  const typed = call.name === BROWSER_TOOL.type && typeof args.text === 'string' ? args.text : '';
  const allow = () => {
    if (reasons.includes('site_not_allowed') && site) {
      // Called synchronously in the click — the gesture Chrome requires.
      void services.sites.request(site).then(
        (granted) => services.host.confirm(chatId, granted),
        () => services.host.confirm(chatId, false),
      );
      return;
    }
    services.host.confirm(chatId, true);
  };

  // Rovr owns WHY it is asking (the safety classification) and the site grant; the bar
  // itself is the shared one every surface shows.
  return (
    <ToolConfirmBar
      className="rovr-confirm"
      req={call}
      onApprove={allow}
      onDeny={() => services.host.confirm(chatId, false)}
      title={t('confirmTitle', t(toolLabelKey(call.name)))}
      labels={{
        approve: reasons.includes('site_not_allowed') && site ? t('allowSite', site) : t('allowOnce'),
        deny: t('deny'),
        aria: t('confirmTitle', t(toolLabelKey(call.name))),
      }}
    >
      {target && <p className="rovr-confirm__target">{target}</p>}
      {typed && (
        <p className="rovr-confirm__target">
          {t('confirmTyping')} <code>{reasons.includes('sensitive_field') ? '••••••' : typed}</code>
        </p>
      )}
      <ul className="rovr-confirm__why">
        {reasons.map((r) => (
          <li key={r}>{r === 'site_not_allowed' && site ? t('reasonSiteNotAllowedNamed', site) : t(REASON_KEY[r])}</li>
        ))}
      </ul>
    </ToolConfirmBar>
  );
}
