"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createFormatters, type LocaleFormatters } from "./i18n";
import { enUSMessages, esESMessages, type AppMessages } from "./messages";

interface LocaleContextValue extends LocaleFormatters {
  locale: string;
  messages: AppMessages;
  setLocale: (nextLocale: string) => void;
  availableLocales: Array<{ code: string; label: string }>;
}

const defaultLocale = "en-US";
const localeStorageKey = "daily3dmaze.locale";
const availableLocales = [
  { code: "en-US", label: "English" },
  { code: "es-ES", label: "Español" }
] as const;

function isSupportedLocale(candidate: string): boolean {
  return availableLocales.some((locale) => locale.code === candidate);
}

function normalizeLocale(candidate: string | null | undefined): string {
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

function resolveMessages(locale: string): AppMessages {
  if (locale.startsWith("es")) {
    return esESMessages;
  }

  return enUSMessages;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  messages: enUSMessages,
  setLocale: () => {},
  availableLocales: [...availableLocales],
  ...createFormatters(defaultLocale)
});

interface LocaleProviderProps {
  children: ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocale] = useState<string>(defaultLocale);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const persistedLocale = window.localStorage.getItem(localeStorageKey);
    if (persistedLocale) {
      setLocale(normalizeLocale(persistedLocale));
      return;
    }

    if (typeof navigator !== "undefined" && navigator.language) {
      setLocale(normalizeLocale(navigator.language));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(localeStorageKey, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      messages: resolveMessages(locale),
      setLocale: (nextLocale: string) => {
        setLocale(normalizeLocale(nextLocale));
      },
      availableLocales: [...availableLocales],
      ...createFormatters(locale)
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
