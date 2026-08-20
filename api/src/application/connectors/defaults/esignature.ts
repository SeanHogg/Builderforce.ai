/**
 * Built-in connectors — E-SIGNATURE.
 *
 * ── WHY THESE ARRIVE NOW AND NOT BEFORE ──────────────────────────────────────
 * The gap register said an e-signature vendor "needs the unimplemented signature
 * engine before a vendor adapter has anything to adapt". The engine shipped —
 * `application/signature/signatureEngine.ts` mints requests, resolves signers,
 * records signatures and expires stale ones, and `signature-reminders` chases
 * them — so the precondition is met and the entry was stale.
 *
 * ── WHAT A VENDOR CONNECTOR IS *FOR* WHEN WE HAVE OUR OWN ENGINE ─────────────
 * Not a second engine. The built-in one is what a contract authored ON this
 * platform goes through, and it stays that way: a request minted here is tracked
 * here, chased here and terminal here.
 *
 * These exist for the documents that were NOT authored here — the MSA a customer
 * sent through their own DocuSign account, the offer letter a founder already had
 * out for signature before they arrived. Without a connector, those are invisible
 * to a board that is supposed to know whether a deal is signed. So the actions
 * lead with LIST and STATUS, and the one send action exists because "get it
 * signed" is a thing a person asks for and the answer should not be "not here".
 *
 * ── ONE THING TO BE CAREFUL ABOUT ────────────────────────────────────────────
 * A document sent through a vendor is NOT tracked by `signature_requests`, so it
 * will not appear in the reminder sweep and its status is only as fresh as the
 * last read. That is a real difference and it belongs in the description a person
 * reads when they choose which door to use — which is why each `send` action says
 * so rather than presenting the two paths as interchangeable.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, ba, p, q, qn } from './dsl';

const docusign: ConnectorManifest = {
  key: 'docusign',
  name: 'DocuSign',
  description: 'List, check and send envelopes in a DocuSign account. For documents already living in DocuSign — a contract authored here goes through the built-in signature engine instead.',
  category: 'productivity',
  icon: '✍️',
  // Account-specific: DocuSign issues a per-account base URI at authentication
  // (`https://<region>.docusign.net/restapi` for production, `demo.docusign.net`
  // for the sandbox). It is a FIELD rather than a constant because the failure it
  // prevents is silent: a production account pointed at `demo.docusign.net`
  // authenticates against a different tenancy, so `send_envelope` reports success
  // and no customer ever receives the document. Guessing the wrong REGION is only
  // slightly better — it 401s with a message about credentials and sends everybody
  // looking in the wrong place.
  baseUrl: '{{auth.base_uri}}/restapi/v2.1',
  docsUrl: 'https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'token', label: 'Access token', secret: true, required: true, help: 'A JWT or OAuth access token for the account. DocuSign tokens are short-lived — reconnect when calls start 401ing.' },
      { key: 'account_id', label: 'Account ID', secret: false, required: true, help: 'DocuSign → Settings → Apps and Keys → API Account ID.' },
      { key: 'base_uri', label: 'Account base URI', secret: false, required: true, placeholder: 'https://na4.docusign.net', help: 'The account base URI DocuSign returns from /oauth/userinfo — e.g. https://na4.docusign.net for production, https://demo.docusign.net for the developer sandbox. No trailing slash.' },
    ],
  },
  actions: [
    {
      key: 'list_envelopes', label: 'List envelopes', description: 'Envelopes changed since a date, with their status — what is out, what is signed.',
      method: 'GET', path: '/accounts/{account_id}/envelopes', mutates: false, resultPath: 'envelopes',
      params: {
        account_id: p('DocuSign account id', { default: '{{auth.account_id}}' }),
        from_date: q('ISO date — only envelopes changed since this'),
        status: q('Comma-separated: sent, delivered, completed, declined, voided'),
        count: qn('Page size'),
      },
    },
    {
      key: 'get_envelope', label: 'Read one envelope', description: 'Full status of a single envelope, including each recipient\'s state.',
      method: 'GET', path: '/accounts/{account_id}/envelopes/{envelope_id}', mutates: false,
      params: {
        account_id: p('DocuSign account id', { default: '{{auth.account_id}}' }),
        envelope_id: p('Envelope id'),
        include: q('Comma-separated extras, e.g. recipients,documents'),
      },
    },
    {
      key: 'send_envelope', label: 'Send for signature', description: 'Send a document for signature through DocuSign. NOT tracked by the built-in reminder sweep — its status is only as fresh as the last read.',
      method: 'POST', path: '/accounts/{account_id}/envelopes', mutates: true, required: ['emailSubject', 'documents', 'recipients'],
      params: {
        account_id: p('DocuSign account id', { default: '{{auth.account_id}}' }),
        emailSubject: b('Subject line the signer sees'),
        status: b('Use "sent" to send immediately, "created" to leave it as a draft'),
        documents: ba('One entry per document: {documentBase64, name, fileExtension, documentId}'),
        recipients: { type: 'object', in: 'body', description: 'Recipient sets, e.g. {signers: [{email, name, recipientId, routingOrder}]}' },
      },
    },
    {
      key: 'void_envelope', label: 'Void an envelope', description: 'Withdraw an envelope that is still out, with a reason the signers see.',
      method: 'PUT', path: '/accounts/{account_id}/envelopes/{envelope_id}', mutates: true, required: ['status', 'voidedReason'],
      params: {
        account_id: p('DocuSign account id', { default: '{{auth.account_id}}' }),
        envelope_id: p('Envelope id'),
        status: b('Set to "voided"'),
        voidedReason: b('Why it was withdrawn — the signers are told this'),
      },
    },
  ],
};

const dropboxSign: ConnectorManifest = {
  key: 'dropbox-sign',
  name: 'Dropbox Sign',
  description: 'List, check and send signature requests in Dropbox Sign (formerly HelloSign).',
  category: 'productivity',
  icon: '🖋️',
  baseUrl: 'https://api.hellosign.com/v3',
  docsUrl: 'https://developers.hellosign.com/api/reference/operation/signatureRequestList/',
  auth: {
    // Dropbox Sign's API key is the basic-auth USERNAME with an empty password —
    // an unusual shape, and the reason the help text says so: pasting the key into
    // a password field authenticates as nobody and 401s.
    kind: 'basic',
    fields: [
      { key: 'username', label: 'API key', secret: true, required: true, help: 'Dropbox Sign → Settings → API. Used as the basic-auth USERNAME; leave the password empty.' },
      { key: 'password', label: 'Leave blank', secret: true, required: false, help: 'Dropbox Sign expects an empty password. This field exists only because basic auth has two halves.' },
    ],
  },
  actions: [
    {
      key: 'list_requests', label: 'List signature requests', description: 'Requests in the account, with their signature status.',
      method: 'GET', path: '/signature_request/list', mutates: false, resultPath: 'signature_requests',
      params: { account_id: q('Restrict to one account id'), page: qn('Page number'), page_size: qn('Page size'), query: q('Search query, e.g. "complete:false"') },
    },
    {
      key: 'get_request', label: 'Read one request', description: 'Full status of a single request, including each signer.',
      method: 'GET', path: '/signature_request/{signature_request_id}', mutates: false,
      params: { signature_request_id: p('Signature request id') },
    },
    {
      key: 'send_request', label: 'Send for signature', description: 'Send a document for signature. NOT tracked by the built-in reminder sweep — its status is only as fresh as the last read.',
      method: 'POST', path: '/signature_request/send', mutates: true, required: ['title', 'signers'],
      // Dropbox Sign's send endpoint is multipart when it carries file bytes; the
      // `file_url` form is declared here because it is the one a Worker can send
      // as JSON, and offering a file field this transport cannot fill would be a
      // form that fails at call time.
      params: {
        title: b('Document title the signer sees'),
        subject: b('Email subject'),
        message: b('Email body'),
        file_url: ba('Publicly reachable URLs of the documents to sign'),
        signers: ba('One entry per signer: {email_address, name, order}'),
        test_mode: { type: 'boolean', in: 'body', description: 'Send without consuming a signature request (sandbox)' },
      },
    },
    {
      key: 'cancel_request', label: 'Cancel a request', description: 'Withdraw a request that has not been completed.',
      method: 'POST', path: '/signature_request/cancel/{signature_request_id}', mutates: true,
      params: { signature_request_id: p('Signature request id') },
    },
  ],
};

export const ESIGNATURE_CONNECTORS: readonly ConnectorManifest[] = [docusign, dropboxSign];
