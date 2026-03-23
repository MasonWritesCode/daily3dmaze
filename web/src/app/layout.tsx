import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LocaleProvider } from "../lib/locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "daily3dmaze",
  description: "A retro-inspired daily 3D maze challenge."
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
