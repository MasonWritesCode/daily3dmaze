"use client";

import { useId } from "react";

import { useLocale } from "../lib/locale";

export default function LocaleSwitcher() {
  const { locale, setLocale, messages, availableLocales } = useLocale();
  const selectId = useId();

  return (
    <div className="locale-switcher">
      <label htmlFor={selectId} className="locale-switcher-label">
        {messages.locale.label}
      </label>
      <select
        id={selectId}
        className="locale-switcher-select"
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
      >
        {availableLocales.map((option) => (
          <option key={option.code} value={option.code}>
            {option.code.startsWith("es") ? messages.locale.spanish : messages.locale.english}
          </option>
        ))}
      </select>
    </div>
  );
}
