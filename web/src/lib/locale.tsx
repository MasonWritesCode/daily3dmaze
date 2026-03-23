"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createFormatters, type LocaleFormatters } from "./i18n";
import { enUSMessages, type AppMessages } from "./messages";

interface LocaleContextValue extends LocaleFormatters {
  locale: string;
  messages: AppMessages;
  setLocale: (nextLocale: string) => void;
}

const defaultLocale = "en-US";
const localeStorageKey = "daily3dmaze.locale";

function normalizeLocale(candidate: string | null | undefined): string {
  if (!candidate) {
    return defaultLocale;
  }

  try {
    return Intl.getCanonicalLocales(candidate)[0] || defaultLocale;
  } catch {
    return defaultLocale;
  }
}

function resolveMessages(_locale: string): AppMessages {
  return enUSMessages;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  messages: enUSMessages,
  setLocale: () => {},
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
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      messages: resolveMessages(locale),
      setLocale: (nextLocale: string) => {
        setLocale(normalizeLocale(nextLocale));
      },
      ...createFormatters(locale)
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
