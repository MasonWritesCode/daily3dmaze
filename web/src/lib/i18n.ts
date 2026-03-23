export interface LocaleFormatters {
  formatDate: (value: string | Date) => string;
  formatDateTime: (value: string | Date) => string;
  formatCount: (value: number) => string;
  formatDayCount: (value: number) => string;
}

export function createFormatters(locale?: string): LocaleFormatters {
  const resolvedLocale = locale || undefined;
  const dateFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    dateStyle: "medium"
  });
  const dateTimeFormatter = new Intl.DateTimeFormat(resolvedLocale, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const numberFormatter = new Intl.NumberFormat(resolvedLocale);
  const pluralRules = new Intl.PluralRules(resolvedLocale);

  function formatCount(value: number): string {
    return numberFormatter.format(value);
  }

  function formatDate(value: string | Date): string {
    return dateFormatter.format(new Date(value));
  }

  function formatDateTime(value: string | Date): string {
    return dateTimeFormatter.format(new Date(value));
  }

  function formatDayCount(value: number): string {
    const unit = pluralRules.select(value) === "one" ? "day" : "days";
    return `${formatCount(value)} ${unit}`;
  }

  return {
    formatDate,
    formatDateTime,
    formatCount,
    formatDayCount
  };
}
