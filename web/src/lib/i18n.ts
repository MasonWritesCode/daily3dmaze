function getLocale(): string | undefined {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return undefined;
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium"
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(getLocale()).format(value);
}

export function formatDayCount(value: number): string {
  const pluralRules = new Intl.PluralRules(getLocale());
  const unit = pluralRules.select(value) === "one" ? "day" : "days";
  return `${formatCount(value)} ${unit}`;
}
