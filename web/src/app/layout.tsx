import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";

import LocaleSwitcher from "../components/LocaleSwitcher";
import { LocaleProvider } from "../lib/locale";
import { localeCookieName, resolvePreferredLocale } from "../lib/locale-config";
import "./globals.css";

export const metadata: Metadata = {
  title: "daily3dmaze",
  description: "A retro-inspired daily 3D maze challenge."
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolvePreferredLocale({
    cookieLocale: cookieStore.get(localeCookieName)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language")
  });

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <LocaleProvider initialLocale={locale}>
          <LocaleSwitcher />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
