"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createFormatters, type LocaleFormatters } from "./i18n";
import { enUSMessages, type AppMessages } from "./messages";

interface LocaleContextValue extends LocaleFormatters {
  locale: string;
  messages: AppMessages;
}

const defaultLocale = "en-US";

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  messages: enUSMessages,
  ...createFormatters(defaultLocale)
});

interface LocaleProviderProps {
  children: ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocale] = useState<string>(defaultLocale);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.language) {
      setLocale(navigator.language);
    }
  }, []);

  const value = useMemo(
    () => ({
      locale,
      messages: enUSMessages,
      ...createFormatters(locale)
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
