/**
 * Strip leading blank lines (lines containing only spaces/tabs, plus their
 * newline) from the start of an outbound WhatsApp message body. WhatsApp renders
 * leading blank lines as awkward empty space, so they are removed before send.
 *
 * Callers apply this only when the target channel is WhatsApp and decide
 * separately what to do when the result is empty.
 */
export function stripWhatsAppLeadingBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "");
}
