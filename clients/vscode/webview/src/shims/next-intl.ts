/**
 * `next-intl` shim for the VS Code canvas bundle.
 *
 * The Creation Canvas is ONE implementation compiled for two surfaces (see
 * `vite.canvas.config.ts`). On the web it runs inside Next.js; here it runs in a
 * plain Vite bundle, and `next-intl` cannot be imported because its entry pulls
 * in Next's server runtime.
 *
 * That is the only thing in the way — the translation ENGINE is already portable:
 * `next-intl`'s client hooks are re-exports of `use-intl`, which is framework
 * agnostic. So this module re-exports `use-intl` and the canvas gets byte-identical
 * behaviour: the same ICU parser, the same plural/select handling, the same
 * `t.rich`, fed by the same catalogs (`frontend/src/i18n/messages/*.json`,
 * trimmed to the namespaces the canvas uses by `bfCanvasMessages()`).
 *
 * `NextIntlClientProvider` is aliased to `use-intl`'s `IntlProvider`, which is
 * what next-intl wraps anyway — so a component that mounts its own provider keeps
 * working unchanged.
 */

export {
  IntlProvider,
  IntlProvider as NextIntlClientProvider,
  useTranslations,
  useFormatter,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  createTranslator,
  createFormatter,
  IntlError,
  IntlErrorCode,
} from 'use-intl';

export type {
  AbstractIntlMessages,
  Formats,
  Locale,
  Messages,
  NamespaceKeys,
  NestedKeyOf,
  NestedValueOf,
  RichTranslationValues,
  TranslationValues,
} from 'use-intl';
