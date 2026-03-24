import { describe, expect, it } from "vitest";

import { createFormatters } from "./i18n";

describe("createFormatters", () => {
  it("formats counts using the selected locale", () => {
    const english = createFormatters("en-US");
    const spanish = createFormatters("es-ES");

    expect(english.formatCount(12345)).toBe("12,345");
    expect(spanish.formatCount(12345)).toBe("12.345");
  });

  it("formats day counts with singular and plural units", () => {
    const formatters = createFormatters("en-US");

    expect(formatters.formatDayCount(1)).toBe("1 day");
    expect(formatters.formatDayCount(3)).toBe("3 days");
  });

  it("formats date and datetime values consistently", () => {
    const formatters = createFormatters("en-US");
    const value = "2026-03-23T19:37:00Z";

    expect(formatters.formatDate(value)).toContain("Mar");
    expect(formatters.formatDateTime(value)).toContain("2026");
  });
});
