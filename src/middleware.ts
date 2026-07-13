import createMiddleware from 'next-intl/middleware';
import { locales } from './i18n/request';

export default createMiddleware({
  // A list of all locales that are supported
  locales,

  // Used when no locale matches
  defaultLocale: 'en',
  
  // Always use relative URLs, regardless of the locale
  localePrefix: 'as-needed',
  
  // Enable automatic detection based on Accept-Language header
  localeDetection: true
});

export const config = {
  // Match only internationalized pathnames
  matcher: ['/', '/(zh|en|fr)/:path*']
};