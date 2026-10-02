/** The device's language as a bare code, e.g. "en" for en-US. Charts are filtered by it. */
export function deviceLanguage(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale.split('-')[0]?.toLowerCase() || 'en';
}
