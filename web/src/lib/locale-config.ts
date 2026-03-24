import { enUSMessages, esESMessages, type AppMessages } from "./messages";

export const defaultLocale = "en-US";
export const localeStorageKey = "daily3dmaze.locale";
export const localeCookieName = "daily3dmaze_locale";
export const availableLocales = [
  { code: "en-US", label: "English" },
  { code: "es-ES", label: "Español" }
] as const;

export function isSupportedLocale(candidate: string): boolean {
  return availableLocales.some((locale) => locale.code === candidate);
}

export function normalizeLocale(candidate: string | null | undefined): string {
  if (!candidate) {
    return defaultLocale;
  }

  try {
    const canonical = Intl.getCanonicalLocales(candidate)[0] || defaultLocale;
    if (isSupportedLocale(canonical)) {
      return canonical;
    }

    if (canonical.startsWith("es")) {
      return "es-ES";
    }

    return defaultLocale;
  } catch {
    return defaultLocale;
  }
}

export function resolveMessages(locale: string): AppMessages {
  if (locale.startsWith("es")) {
    return esESMessages;
  }

  return enUSMessages;
}

export function resolvePreferredLocale(options: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}) {
  if (options.cookieLocale) {
    return normalizeLocale(options.cookieLocale);
  }

  const acceptedLanguage = options.acceptLanguage
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);

  return normalizeLocale(acceptedLanguage);
}
