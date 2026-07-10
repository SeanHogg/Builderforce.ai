import { IntlErrorCode, type IntlError } from 'next-intl';

/**
 * Shared next-intl error handler.
 *
 * The app formats dates/relative-times in the VIEWER's environment (local clock
 * + local time zone) on purpose — it is a cookie-locale product with global
 * users and no per-user time zone, so "5 minutes ago" and local wall-clock times
 * are exactly what we want. next-intl flags that intentional choice by logging an
 * `ENVIRONMENT_FALLBACK` error on every `format.relativeTime` / `format.dateTime`
 * call; rendered inside a `.map`, that floods the console with one error per row.
 *
 * Swallow ONLY that benign code (in both the server request config and the
 * client provider) and let every genuine i18n error — missing message, bad
 * format, etc. — surface to the console as before.
 */
export function ignoreEnvironmentFallback(error: IntlError): void {
  if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) return;
  console.error(error);
}
