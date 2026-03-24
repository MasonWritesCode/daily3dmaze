"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createFormatters, type LocaleFormatters } from "./i18n";
import {
  availableLocales,
  defaultLocale,
  localeCookieName,
  localeStorageKey,
  normalizeLocale,
  resolveMessages
} from "./locale-config";
import { enUSMessages, type AppMessages } from "./messages";

interface LocaleContextValue extends LocaleFormatters {
  locale: string;
  messages: AppMessages;
  setLocale: (nextLocale: string) => void;
  availableLocales: Array<{ code: string; label: string }>;
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
  initialLocale?: string;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocale] = useState<string>(normalizeLocale(initialLocale ?? defaultLocale));

  useEffect(() => {
    if (typeof window === "undefined" || initialLocale) {
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
  }, [initialLocale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(localeStorageKey, locale);
    document.documentElement.lang = locale;
    document.cookie = `${localeCookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
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
