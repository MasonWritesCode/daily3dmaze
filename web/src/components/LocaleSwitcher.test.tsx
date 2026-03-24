import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import LocaleSwitcher from "./LocaleSwitcher";
import { LocaleProvider } from "../lib/locale";

describe("LocaleSwitcher", () => {
  it("hydrates from persisted locale and updates the document language", async () => {
    window.localStorage.setItem("daily3dmaze.locale", "es-ES");

    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>
    );

    const select = await screen.findByLabelText("Idioma");

    expect(select).toHaveValue("es-ES");
    expect(document.documentElement.lang).toBe("es-ES");
  });

  it("persists locale changes when the user selects a new language", async () => {
    const user = userEvent.setup();

    render(
      <LocaleProvider>
        <LocaleSwitcher />
      </LocaleProvider>
    );

    const select = screen.getByLabelText("Language");
    await user.selectOptions(select, "es-ES");

    expect(window.localStorage.getItem("daily3dmaze.locale")).toBe("es-ES");
    expect(document.documentElement.lang).toBe("es-ES");
    expect(screen.getByLabelText("Idioma")).toHaveValue("es-ES");
  });
});
