/**
 * The ATS's refusal type.
 *
 * One error class across applications, pipeline, kits, decisions and offers so the route
 * has ONE `instanceof` to map onto a status code. The alternative — each service
 * returning its own `{ error }` shape — is what makes a route re-decide, per endpoint,
 * whether "already sent" is a 400 or a 409, and they never agree for long.
 *
 * Modelled on `SignatureError` and `LegalDocumentError`, which are the same class for
 * the same reason in the two neighbouring domains.
 */
export class AtsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AtsError';
  }
}
