import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { ApiRequestError } from '@/lib/apiClient';
import { DO_NOT_CONTACT_CODE, mailboxApi } from '@/lib/mailboxApi';

type Message = Parameters<typeof mailboxApi.send>[1];
type Receipt = Awaited<ReturnType<typeof mailboxApi.send>>;

/**
 * Send one email from a connected mailbox, with the do-not-contact warning every composer owes.
 *
 * A person may knowingly write to someone on a do-not-contact list (a reply to a customer who
 * unsubscribed from marketing), but must be told first: the server answers 409
 * `do_not_contact` and sends nothing until the request carries `confirmDoNotContact`. This asks
 * with the shared confirm modal and resends once if the person agrees, so the inbox and the
 * canvas composer cannot drift on the wording or the flow.
 *
 * Resolves to the receipt, or to `null` when the person declined to send. Any other failure
 * throws, for the caller's own error handling.
 */
export function useSendMailboxMessage(): (connectionId: number, message: Message) => Promise<Receipt | null> {
  const t = useTranslations('mailboxSend');
  const confirm = useConfirm();
  return useCallback(async (connectionId: number, message: Message): Promise<Receipt | null> => {
    try {
      return await mailboxApi.send(connectionId, message);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== DO_NOT_CONTACT_CODE) throw error;
    }
    const proceed = await confirm({
      title: t('doNotContactTitle'),
      message: t('doNotContactMessage'),
      confirmLabel: t('sendAnyway'),
      destructive: true,
    });
    return proceed ? mailboxApi.send(connectionId, { ...message, confirmDoNotContact: true }) : null;
  }, [confirm, t]);
}
